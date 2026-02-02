import express from "express";
import { createRedisClient } from "../redis/client.js";
import { cacheGetOrSetJson } from "../redis/cache.js";
import {
  getRestaurantBySlug,
  getMenuForRestaurant,
  createCategory,
  updateCategory,
  deleteCategory,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  setItemAvailability,
  updateMenuItemImage,
} from "./service.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { z } from "zod";
import { createPresignedUploadUrl, publicFileUrl } from "../media/s3.js";
import { v4 as uuidv4 } from "uuid";
import { rateLimit } from "../middleware/rateLimit.js";
import { createPgPool } from "../db.js";
import { getMenuForRestaurantWithCustomizations } from "../customization/service.js";

const router = express.Router();
const pool = createPgPool(env.databaseUrl);

let redis = null;
function getRedis() {
  if (redis) return redis;
  if (process.env.REDIS_URL || process.env.REDIS_MODE === "cluster") {
    redis = createRedisClient();
  }
  return redis;
}

// Helper function to invalidate menu cache
async function invalidateMenuCache(restaurantId) {
  const redisClient = getRedis();
  if (redisClient) {
    try {
      const restaurant = await pool.query('SELECT slug FROM restaurants WHERE id = $1', [restaurantId]);
      if (restaurant.rows[0]) {
        const slug = restaurant.rows[0].slug;
        
        // Delete all dietary filter variants
        const cacheKeys = [
          `menu:${slug}:all`,     // Default/no filter
          `menu:${slug}:veg`,     // Veg filter
          `menu:${slug}:non-veg`, // Non-veg filter
        ];
        
        // Delete all keys in parallel
        await Promise.all(
          cacheKeys.map(key => 
            redisClient.del(key).catch(err => 
              console.error(`[menu-routes] Failed to delete cache key ${key}:`, err)
            )
          )
        );
        
        console.log(`[menu-routes] Invalidated ${cacheKeys.length} cache keys for slug: ${slug}`);
      }
    } catch (err) {
      console.error('[menu-routes] Cache invalidation error:', err);
    }
  }
}

export function registerMenuRoutes(app) {
  // Public menu by restaurant slug (for /r/:slug)
  router.get(
    "/public/:slug",
    asyncHandler(async (req, res) => {
      const { slug } = req.params;
      const { dietary } = req.query; // Accept 'veg', 'non-veg', or 'any' (default)
      
      // Validate dietary filter
      const dietaryFilter = dietary && (dietary === 'veg' || dietary === 'non-veg') ? dietary : null;
      
      const redisClient = getRedis();
      // Include filter in cache key for proper cache separation
      const cacheKey = `menu:${slug}:${dietaryFilter || 'all'}`;
      const ttlSeconds = env.menuCacheTtlSec;

      const producer = async () => {
        const restaurant = await getRestaurantBySlug(slug);
        if (!restaurant) {
          const err = new Error("Restaurant not found");
          err.status = 404;
          throw err;
        }

        const menu = await getMenuForRestaurantWithCustomizations(restaurant.id, dietaryFilter);
        return {
          restaurant,
          ...menu,
        };
      };

      if (redisClient) {
        const data = await cacheGetOrSetJson(redisClient, cacheKey, ttlSeconds, producer);
        return res.json(data);
      }

      const data = await producer();
      return res.json(data);
    }),
  );

  // Protected: category CRUD
  const categorySchema = z.object({
    name: z.string().min(1).max(150),
    sortOrder: z.number().int().optional(),
  });
  const categoryUpdateSchema = categorySchema.partial().extend({
    isActive: z.boolean().optional(),
  });

  router.post(
    "/:restaurantId/categories",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:categories:create", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = categorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const category = await createCategory(restaurantId, parsed.data);
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.status(201).json({ category });
    }),
  );

  router.put(
    "/:restaurantId/categories/:categoryId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:categories:update", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, categoryId } = req.params;
      const parsed = categoryUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const category = await updateCategory(restaurantId, categoryId, parsed.data);
      if (!category) return res.status(404).json({ message: "Not found" });
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.json({ category });
    }),
  );

  router.delete(
    "/:restaurantId/categories/:categoryId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:categories:delete", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, categoryId } = req.params;
      const category = await deleteCategory(restaurantId, categoryId);
      if (!category) return res.status(404).json({ message: "Not found" });
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.json({ category, deleted: true });
    }),
  );

  // Protected: menu item CRUD
  const menuItemSchema = z.object({
    categoryId: z.string().uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    price: z.number().positive(),
    imageUrl: z.string().url().optional(),
    isAvailable: z.boolean().optional(),
    dietaryTags: z.array(z.string()).optional(),
    sortOrder: z.number().int().optional(),
  });
  const menuItemUpdateSchema = menuItemSchema.partial();
  const availabilitySchema = z.object({
    isAvailable: z.boolean(),
  });
  const uploadSchema = z.object({
    contentType: z.string().optional(),
  });
  const imagePersistSchema = z.object({
    imageUrl: z.string().url(),
  });

  router.post(
    "/:restaurantId/items",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:items:create", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = menuItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const item = await createMenuItem(restaurantId, parsed.data);
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.status(201).json({ item });
    }),
  );

  router.put(
    "/:restaurantId/items/:itemId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:items:update", windowSeconds: 60, max: 240 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, itemId } = req.params;
      const parsed = menuItemUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const item = await updateMenuItem(restaurantId, itemId, parsed.data);
      if (!item) return res.status(404).json({ message: "Not found" });
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.json({ item });
    }),
  );

  router.delete(
    "/:restaurantId/items/:itemId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:items:delete", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, itemId } = req.params;
      const item = await deleteMenuItem(restaurantId, itemId);
      if (!item) return res.status(404).json({ message: "Not found" });
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.json({ item, deleted: true });
    }),
  );

  // Availability toggle
  router.patch(
    "/:restaurantId/items/:itemId/availability",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:items:availability", windowSeconds: 60, max: 300 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, itemId } = req.params;
      const parsed = availabilitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const item = await setItemAvailability(restaurantId, itemId, parsed.data.isAvailable);
      if (!item) return res.status(404).json({ message: "Not found" });
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.json({ item });
    }),
  );

  // S3 image upload URL
  router.post(
    "/:restaurantId/items/:itemId/image/upload-url",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:items:imageUploadUrl", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, itemId } = req.params;
      const parsed = uploadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      if (!env.s3Bucket || !env.s3Region) {
        return res.status(500).json({ message: "S3 not configured" });
      }

      const contentType = parsed.data.contentType || "image/jpeg";
      const key = `restaurants/${restaurantId}/menu-items/${itemId}/${uuidv4()}`;
      const uploadUrl = await createPresignedUploadUrl({ key, contentType, expiresIn: 300 });
      const publicUrl = publicFileUrl(key);

      res.json({
        uploadUrl,
        key,
        publicUrl,
        expiresIn: 300,
      });
    }),
  );

  // Persist imageUrl after successful upload
  router.put(
    "/:restaurantId/items/:itemId/image",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "menu:items:imagePersist", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, itemId } = req.params;
      const parsed = imagePersistSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const item = await updateMenuItemImage(restaurantId, itemId, parsed.data.imageUrl);
      if (!item) return res.status(404).json({ message: "Not found" });
      
      // Invalidate cache for instant updates
      await invalidateMenuCache(restaurantId);
      
      res.json({ item });
    }),
  );

  app.use("/api/menu", router);
}