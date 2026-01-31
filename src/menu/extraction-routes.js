import express from "express";
import { createPgPool } from "../db.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { 
  createExtractionJob, 
  getExtractionJob,
  getRestaurantExtractionJobs 
} from "./extraction-service.js";
import { createPresignedUploadUrl, publicFileUrl } from "../media/s3.js";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { invalidateMenuCache } from "./cache-utils.js";

const router = express.Router();
const pool = createPgPool(env.databaseUrl);

// Validation schemas
const uploadSchema = z.object({
  contentType: z.string().optional(),
});

const createJobSchema = z.object({
  imageUrl: z.string().url(),
  imageS3Key: z.string(),
  imageSizeBytes: z.number().int().positive(),
});

const confirmItemsSchema = z.object({
  items: z.array(z.object({
    categoryName: z.string(),
    name: z.string(),
    price: z.number().positive(),
    description: z.string().optional(),
    dietaryType: z.enum(['Veg', 'Non-Veg']).optional(),
  })),
});

/**
 * POST /api/menu/:restaurantId/menu-card/upload-url
 * Get presigned S3 URL for uploading menu card image
 */
router.post(
  "/:restaurantId/menu-card/upload-url",
  requireAuth,
  requireRole("owner", "admin"),
  rateLimit({ keyPrefix: "menu:card:uploadUrl", windowSeconds: 60, max: 20 }),
  asyncHandler(async (req, res) => {
    const { restaurantId } = req.params;
    const parsed = uploadSchema.safeParse(req.body || {});
    
    if (!parsed.success) {
      return res.status(400).json({ 
        message: "Invalid input", 
        errors: parsed.error.errors 
      });
    }

    if (!env.s3Bucket || !env.s3Region) {
      return res.status(500).json({ message: "S3 not configured" });
    }

    const contentType = parsed.data.contentType || "image/jpeg";
    const key = `restaurants/${restaurantId}/menu-cards/${uuidv4()}`;
    const uploadUrl = await createPresignedUploadUrl({ 
      key, 
      contentType, 
      expiresIn: 300 
    });
    const publicUrl = publicFileUrl(key);

    res.json({
      uploadUrl,
      key,
      publicUrl,
      expiresIn: 300,
    });
  })
);

/**
 * POST /api/menu/:restaurantId/extract
 * Create a new extraction job after image is uploaded
 */
router.post(
  "/:restaurantId/extract",
  requireAuth,
  requireRole("owner", "admin"),
  rateLimit({ keyPrefix: "menu:extract", windowSeconds: 60, max: 10 }),
  asyncHandler(async (req, res) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;

    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        message: "Invalid input", 
        errors: parsed.error.errors 
      });
    }

    const job = await createExtractionJob({
      restaurantId,
      uploadedBy: userId,
      ...parsed.data,
    });

    res.status(201).json({ job });
  })
);

/**
 * GET /api/menu/:restaurantId/extract/:jobId
 * Get extraction job status
 */
router.get(
  "/:restaurantId/extract/:jobId",
  requireAuth,
  requireRole("owner", "admin"),
  asyncHandler(async (req, res) => {
    const { restaurantId, jobId } = req.params;

    const job = await getExtractionJob(jobId);
    
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Verify restaurant ownership
    if (job.restaurant_id !== restaurantId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json({ job });
  })
);

/**
 * POST /api/menu/:restaurantId/extract/:jobId/confirm
 * Confirm extraction and create menu items
 */
router.post(
  "/:restaurantId/extract/:jobId/confirm",
  requireAuth,
  requireRole("owner", "admin"),
  rateLimit({ keyPrefix: "menu:extract:confirm", windowSeconds: 60, max: 10 }),
  asyncHandler(async (req, res) => {
    const { restaurantId, jobId } = req.params;

    const parsed = confirmItemsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        message: "Invalid input", 
        errors: parsed.error.errors 
      });
    }

    // Verify job exists and is completed
    const job = await getExtractionJob(jobId);
    
    if (!job || job.restaurant_id !== restaurantId) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (job.status !== 'COMPLETED') {
      return res.status(400).json({ 
        message: "Job not completed yet" 
      });
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const categoryMap = new Map();
      const createdItems = [];

      for (const item of parsed.data.items) {
        // Get or create category
        let categoryId = categoryMap.get(item.categoryName);
        
        if (!categoryId) {
          const catResult = await client.query(
            `INSERT INTO menu_categories (restaurant_id, name, is_active)
             VALUES ($1, $2, true)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [restaurantId, item.categoryName]
          );
          
          // If conflict (category exists), fetch it
          if (catResult.rows.length === 0) {
            const existingCat = await client.query(
              `SELECT id FROM menu_categories 
               WHERE restaurant_id = $1 AND name = $2`,
              [restaurantId, item.categoryName]
            );
            categoryId = existingCat.rows[0].id;
          } else {
            categoryId = catResult.rows[0].id;
          }
          
          categoryMap.set(item.categoryName, categoryId);
        }

        // Create menu item
        const itemResult = await client.query(
          `INSERT INTO menu_items
            (restaurant_id, category_id, name, description, price, 
             is_available, dietary_tags, extraction_job_id, is_ai_extracted)
           VALUES ($1, $2, $3, $4, $5, true, $6, $7, true)
           RETURNING *`,
          [
            restaurantId,
            categoryId,
            item.name,
            item.description || null,
            item.price,
            item.dietaryType ? [item.dietaryType] : null,
            jobId,
          ]
        );

        createdItems.push(itemResult.rows[0]);
      }

      // Update job status
      await client.query(
        `UPDATE menu_extraction_jobs
         SET status = 'CONFIRMED',
             confirmed_at = NOW(),
             items_confirmed = $1
         WHERE id = $2`,
        [createdItems.length, jobId]
      );

      await client.query('COMMIT');

      console.log(`[Extraction] Confirmed ${createdItems.length} items for job ${jobId}`);

      await invalidateMenuCache(restaurantId);


      res.json({ 
        success: true,
        itemsCreated: createdItems.length,
        items: createdItems 
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

/**
 * GET /api/menu/:restaurantId/extractions
 * Get extraction history for restaurant
 */
router.get(
  "/:restaurantId/extractions",
  requireAuth,
  requireRole("owner", "admin"),
  asyncHandler(async (req, res) => {
    const { restaurantId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const extractions = await getRestaurantExtractionJobs(restaurantId, limit);

    res.json({ extractions });
  })
);

export function registerExtractionRoutes(app) {
  app.use("/api/menu", router);
}