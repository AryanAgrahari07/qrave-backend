import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getPredefinedLogos,
  generateLogoUploadUrl,
  updateRestaurantLogo,
  getRestaurantLogo,
  deleteRestaurantLogo,
} from "./service.js";

const router = express.Router();

const logoUploadSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/jpg']),
});

const logoUpdateSchema = z.object({
  type: z.enum(['predefined', 'custom']),
  url: z.string(),
  key: z.string().optional().nullable(),
});

export function registerLogoRoutes(app) {
  // Get predefined logo templates
  router.get(
    "/templates",
    asyncHandler(async (req, res) => {
      const category = req.query.category || null;
      const logos = await getPredefinedLogos(category);
      res.json({ logos });
    })
  );

  // Generate presigned URL for custom logo upload
  router.post(
    "/:restaurantId/upload-url",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      
      const parsed = logoUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: parsed.error.errors 
        });
      }

      const uploadData = await generateLogoUploadUrl(
        restaurantId,
        parsed.data.contentType
      );

      res.json(uploadData);
    })
  );

  // Update restaurant logo
  router.put(
    "/:restaurantId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      
      const parsed = logoUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: parsed.error.errors 
        });
      }

      const restaurant = await updateRestaurantLogo(restaurantId, parsed.data);
      res.json({ 
        success: true,
        restaurant,
        message: "Logo updated successfully"
      });
    })
  );

  // Get restaurant logo
  router.get(
    "/:restaurantId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const logo = await getRestaurantLogo(restaurantId);
      res.json({ logo });
    })
  );

  // Delete restaurant logo
  router.delete(
    "/:restaurantId",
    requireAuth,
    requireRole("owner", "admin", "platform_admin"),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const restaurant = await deleteRestaurantLogo(restaurantId);
      res.json({ 
        success: true,
        restaurant,
        message: "Logo removed successfully"
      });
    })
  );

  app.use("/api/logos", router);
}