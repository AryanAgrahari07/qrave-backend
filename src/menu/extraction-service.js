import { enqueueJob } from "../jobs/redis-jobs.js";
import { pool } from "../dbClient.js";

/**
 * Create a new extraction job
 */
export async function createExtractionJob(data) {
  const { restaurantId, uploadedBy, imageUrl, imageS3Key, imageSizeBytes } = data;
  
  const result = await pool.query(
    `INSERT INTO menu_extraction_jobs 
      (restaurant_id, uploaded_by, image_url, image_s3_key, image_size_bytes, status)
     VALUES ($1, $2, $3, $4, $5, 'PENDING')
     RETURNING id, status, created_at`,
    [restaurantId, uploadedBy, imageUrl, imageS3Key, imageSizeBytes]
  );
  
  const job = result.rows[0];
  
  // Enqueue for processing
  await enqueueJob({
    jobId: job.id,
    restaurantId,
    imageUrl,
    imageS3Key,
  });
  
  console.log(`[Extraction] Job ${job.id} created and enqueued`);
  
  return job;
}

/**
 * Get extraction job by ID
 */
export async function getExtractionJob(jobId) {
  const result = await pool.query(
    `SELECT * FROM menu_extraction_jobs WHERE id = $1`,
    [jobId]
  );
  return result.rows[0] || null;
}

/**
 * Get all extraction jobs for a restaurant
 */
export async function getRestaurantExtractionJobs(restaurantId, limit = 10) {
  const result = await pool.query(
    `SELECT id, status, extraction_confidence, items_extracted, 
            created_at, completed_at, error_message
     FROM menu_extraction_jobs
     WHERE restaurant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [restaurantId, limit]
  );
  return result.rows;
}

/**
 * Update extraction job status
 */
export async function updateExtractionJobStatus(jobId, status, errorMessage = null) {
  const result = await pool.query(
    `UPDATE menu_extraction_jobs
     SET status = $1, 
         error_message = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, errorMessage, jobId]
  );
  return result.rows[0] || null;
}

/**
 * Complete extraction job with extracted data
 */
export async function completeExtractionJob(jobId, extractedData, confidence, modelUsed) {
  const result = await pool.query(
    `UPDATE menu_extraction_jobs
     SET status = 'COMPLETED',
         extracted_data = $1,
         extraction_confidence = $2,
         ai_model_used = $3,
         items_extracted = $4,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [
      JSON.stringify(extractedData),
      confidence,
      modelUsed,
      extractedData.items?.length || 0,
      jobId
    ]
  );
  return result.rows[0] || null;
}