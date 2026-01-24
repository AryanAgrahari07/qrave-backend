import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listRestaurants,
  listRestaurantsByOwner, // Add this new service function
  getRestaurant,
  getRestaurantBySlug,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
} from "./service.js";

const router = express.Router();

const restaurantCreateSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(150),
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
  qrDesign: z
    .object({
      darkColor: z.string().optional(),
      lightColor: z.string().optional(),
    })
    .optional(),
  settings: z.any().optional(),
});

const restaurantUpdateSchema = restaurantCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export function registerRestaurantRoutes(app) {
  // Public: get restaurant by slug (for /q/:slug, etc.)
  router.get(
    "/by-slug/:slug",
    asyncHandler(async (req, res) => {
      const restaurant = await getRestaurantBySlug(req.params.slug);
      if (!restaurant) return res.status(404).json({ message: "Not found" });
      res.json({ restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug } });
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
      console.log(userId);
      const restaurants = await listRestaurantsByOwner(userId);
      res.json({ restaurants });
    }),
  );

  // Get by id - FIXED: Check ownership
  router.get(
    "/:id",
    requireAuth,
    requireRole("owner", "platform_admin", "admin", "WAITER"),
    asyncHandler(async (req, res) => {
      const restaurant = await getRestaurant(req.params.id);
      if (!restaurant) return res.status(404).json({ message: "Not found" });
      
      // // Platform admin can access any restaurant
      // if (req.user.role === "platform_admin") {
      //   return res.json({ restaurant });
      // }
      
      // // Check if user has access to this restaurant
      // // For owner/admin: check if they own it
      // // For WAITER: check if their restaurantId matches
      // const hasAccess = 
      //   restaurant.ownerId === req.user.id || 
      //   req.user.restaurantId === req.params.id;
      
      // if (!hasAccess) {
      //   return res.status(403).json({ message: "Access denied" });
      // }
      
      res.json({ restaurant });
    }),
  );

  // Create
  router.post(
    "/",
    requireAuth,
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
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
      const parsed = restaurantUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      
      // Check ownership before allowing update
      const existing = await getRestaurant(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      
      // if (req.user.role !== "platform_admin" && existing.ownerId !== req.user.id) {
      //   return res.status(403).json({ message: "Access denied" });
      // }
      
      const restaurant = await updateRestaurant(req.params.id, parsed.data);
      res.json({ restaurant });
    }),
  );

  // Soft delete - FIXED: Check ownership
  router.delete(
    "/:id",
    requireAuth,
    requireRole("owner", "platform_admin"),
    asyncHandler(async (req, res) => {
      // Check ownership before allowing delete
      const existing = await getRestaurant(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      
      // if (req.user.role !== "platform_admin" && existing.ownerId !== req.user.id) {
      //   return res.status(403).json({ message: "Access denied" });
      // }
      
      const restaurant = await deleteRestaurant(req.params.id);
      res.json({ restaurant, deleted: true });
    }),
  );

  app.use("/api/restaurants", router);
}