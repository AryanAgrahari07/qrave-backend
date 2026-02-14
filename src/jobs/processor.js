import { pool } from '../dbClient.js';
import { extractMenuFromImage, calculateConfidence } from '../ai/gemini-client.js';
import crypto from 'crypto';
import sharp from 'sharp';

// Supported MIME types by Gemini
const GEMINI_SUPPORTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
];

/**
 * Convert image to JPEG if format is not supported by Gemini
 */
async function ensureSupportedFormat(imageBuffer, mimeType) {
  // If already supported, return as-is
  if (GEMINI_SUPPORTED_TYPES.includes(mimeType)) {
    return { buffer: imageBuffer, mimeType };
  }

  console.log(`[Processor] Converting ${mimeType} to JPEG for Gemini compatibility`);

  try {
    // Convert to JPEG with high quality
    const convertedBuffer = await sharp(imageBuffer)
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();

    return { 
      buffer: convertedBuffer, 
      mimeType: 'image/jpeg' 
    };
  } catch (error) {
    console.error('[Processor] Image conversion failed:', error);
    throw new Error(`Failed to convert image format: ${error.message}`);
  }
}

/**
 * Process a menu extraction job
 */
export async function processExtractionJob(jobData) {
  const { jobId, restaurantId, imageUrl, imageS3Key } = jobData;
  const startTime = Date.now();

  console.log(`[Processor] Starting job ${jobId}`);

  try {
    // Update status to PROCESSING
    await pool.query(
      `UPDATE menu_extraction_jobs 
       SET status = 'PROCESSING', started_at = NOW()
       WHERE id = $1`,
      [jobId]
    );

    // Fetch image from S3
    console.log(`[Processor] Fetching image from ${imageUrl}`);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }

    let imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    let originalMimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    
    // Calculate image hash for duplicate detection (use original buffer)
    const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

    // Convert to supported format if needed
    const { buffer: processedBuffer, mimeType } = await ensureSupportedFormat(
      imageBuffer, 
      originalMimeType
    );

    // Check for duplicate (same image processed in last 30 days)
    const duplicate = await pool.query(
      `SELECT id, extracted_data, extraction_confidence 
       FROM menu_extraction_jobs
       WHERE restaurant_id = $1 
         AND image_hash = $2 
         AND status = 'COMPLETED'
         AND created_at > NOW() - INTERVAL '30 days'
       LIMIT 1`,
      [restaurantId, imageHash]
    );

    let extractedData;
    let confidence;
    let modelUsed = 'gemini-2.5-flash';

    if (duplicate.rows.length > 0) {
      console.log(`[Processor] Using cached extraction from job ${duplicate.rows[0].id}`);
      extractedData = duplicate.rows[0].extracted_data;
      confidence = duplicate.rows[0].extraction_confidence;
    } else {
      // Extract with AI (use converted buffer and MIME type)
      console.log(`[Processor] Calling Gemini API with ${mimeType}...`);
      const result = await extractMenuFromImage(processedBuffer, mimeType);
      extractedData = result;
      confidence = calculateConfidence(result);
      console.log(`[Processor] Extraction complete. Confidence: ${confidence}%`);
    }

    const processingTime = Date.now() - startTime;

    // Update job with results
    await pool.query(
      `UPDATE menu_extraction_jobs
       SET status = 'COMPLETED',
           extracted_data = $1,
           extraction_confidence = $2,
           ai_model_used = $3,
           image_hash = $4,
           processing_time_ms = $5,
           completed_at = NOW(),
           items_extracted = $6
       WHERE id = $7`,
      [
        JSON.stringify(extractedData),
        confidence,
        modelUsed,
        imageHash,
        processingTime,
        extractedData.categories.reduce((sum, cat) => sum + cat.items.length, 0),
        jobId,
      ]
    );

    console.log(`[Processor] Job ${jobId} completed in ${processingTime}ms`);
    return { success: true, processingTime };

  } catch (error) {
    console.error(`[Processor] Job ${jobId} failed:`, error);

    await pool.query(
      `UPDATE menu_extraction_jobs
       SET status = 'FAILED',
           error_message = $1,
           completed_at = NOW(),
           retry_count = retry_count + 1
       WHERE id = $2`,
      [error.message, jobId]
    );

    throw error;
  }
}