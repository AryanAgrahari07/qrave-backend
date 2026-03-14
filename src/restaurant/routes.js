import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscriptionBlocked.js";
import {
  listRestaurants,
  listRestaurantsByOwner, // Add this new service function
  getRestaurant,
  getRestaurantBySlug,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
} from "./service.js";
import { getRedisClient } from "../redis/client.js";
import { cacheGetOrSetJson } from "../redis/cache.js";
import { invalidateMenuCache } from "../menu/routes.js";

const router = express.Router();

const slugSchema = z
  .string()
  .min(2)
  .max(150)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug can contain only lowercase letters, numbers and hyphens")
  .transform((s) => s.toLowerCase());

const restaurantCreateSchema = z.object({
  name: z.string().min(2).max(200),
  slug: slugSchema,
  type: z.string().max(50).optional(),
  currency: z.string().max(10).optional(),
  plan: z.string().max(50).optional(),
  taxRateGst: z.string().optional(),
  taxRateService: z.string().optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(100).optional(),
  gstNumber: z.string().max(20).nullable().optional(),
  fssaiNumber: z.string().max(20).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  phoneNumber: z.string().max(20).nullable().optional(),
  googleMapsLink: z.string().url().nullable().optional(),
  qrDesign: z
    .object({
      darkColor: z.string().optional(),
      lightColor: z.string().optional(),
    })
    .optional(),
  settings: z.record(z.unknown()).optional(), // SEC-1 FIX: Reject arbitrary arrays/strings, require object
});

const restaurantUpdateSchema = restaurantCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
  slug: slugSchema.optional(),
});

export function registerRestaurantRoutes(app) {
  // Public: get restaurant by slug (for /q/:slug, etc.)
  router.get(
    "/by-slug/:slug",
    asyncHandler(async (req, res) => {
      const { slug } = req.params;
      const redisClient = getRedisClient();
      const cacheKey = `restaurant:slug:${slug}`;
      const ttlSeconds = 300; // 5 mins cache
      
      const producer = async () => {
        const restaurant = await getRestaurantBySlug(slug);
        if (!restaurant) {
          const err = new Error("Not found");
          err.status = 404;
          throw err;
        }
        return { restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug } };
      };
      
      if (redisClient) {
        try {
          const data = await cacheGetOrSetJson(redisClient, cacheKey, ttlSeconds, producer);
          res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
          return res.json(data);
        } catch (err) {
          if (err.status === 404) return res.status(404).json({ message: "Not found" });
          throw err;
        }
      }
      
      try {
        const data = await producer();
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
        return res.json(data);
      } catch (err) {
        if (err.status === 404) return res.status(404).json({ message: "Not found" });
        throw err;
      }
    }),
  );

  // List restaurants - FIXED: Only platform_admin sees all, others see their own
  router.get(
    "/",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
      // Platform admin can see all restaurants
      if (req.user.role === "platform_admin") {
        const restaurants = await listRestaurants();
        return res.json({ restaurants });
      }
      
      // Regular owners and admins only see restaurants they own/manage
      const userId = req.user.id;
      const restaurants = await listRestaurantsByOwner(userId);
      res.json({ restaurants });
    }),
  );

  // Get by id - FIXED: Check ownership + Staff access
  router.get(
    "/:id",
    requireAuth,
    requireRole("owner", "platform_admin", "admin", "WAITER", "KITCHEN"),
    asyncHandler(async (req, res) => {
      const restaurant = await getRestaurant(req.params.id);
      if (!restaurant) return res.status(404).json({ message: "Not found" });
      
      // Platform admin can access any restaurant
      if (req.user.role === "platform_admin") {
        return res.json({ restaurant });
      }
      
      // Check if user has access to this restaurant
      // For owner/admin: check if they own it
      // For WAITER/KITCHEN: check if their restaurantId matches
      const hasAccess = 
        restaurant.ownerId === req.user.id || 
        req.user.restaurantId === req.params.id;
      
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json({ restaurant });
    }),
  );

  // Create
  router.post(
    "/",
    requireAuth,
    requireActiveSubscription,
    requireRole("owner", "platform_admin"),
    asyncHandler(async (req, res) => {
      const parsed = restaurantCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      // Set the owner to the current user (unless platform_admin is creating for someone else)
      const restaurantData = {
        ...parsed.data,
        ownerId: req.body.ownerId || req.user.id, // Allow platform_admin to set different owner
      };
      
      const restaurant = await createRestaurant(restaurantData);
      res.status(201).json({ restaurant });
    }),
  );

  // Update - FIXED: Check ownership
  router.put(
    "/:id",
    requireAuth,
    requireActiveSubscription,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
      const parsed = restaurantUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      // Check ownership before allowing update
      const existing = await getRestaurant(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      
      const hasAccess = 
        req.user.role === "platform_admin" ||
        existing.ownerId === req.user.id ||
        req.user.restaurantId === req.params.id;

      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const restaurant = await updateRestaurant(req.params.id, parsed.data);
      if (restaurant) {
        await invalidateMenuCache(restaurant.id);
      }
      res.json({ restaurant });
    }),
  );

  // Soft delete - FIXED: Check ownership
  router.delete(
    "/:id",
    requireAuth,
    requireActiveSubscription,
    requireRole("owner", "platform_admin"),
    asyncHandler(async (req, res) => {
      // Check ownership before allowing delete
      const existing = await getRestaurant(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      
      if (req.user.role !== "platform_admin" && existing.ownerId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const restaurant = await deleteRestaurant(req.params.id);
      res.json({ restaurant, deleted: true });
    }),
  );

  app.use("/api/restaurants", router);
}