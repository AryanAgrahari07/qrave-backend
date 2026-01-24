import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  generateRestaurantQR,
  generateTableQR,
  generateAllTableQRs,
  updateTableQRPayload,
  getQRStats,
} from "./service.js";

const router = express.Router();

const qrGenerateSchema = z.object({
  type: z.enum(["RESTAURANT", "TABLE"]).optional().default("RESTAURANT"),
  tableId: z.string().uuid().optional(),
});

const qrUpdatePayloadSchema = z.object({
  tableId: z.string().uuid(),
  payload: z.string().min(1),
});

export function registerQRRoutes(app) {
  // QR Code routes

  // Generate QR code for restaurant or specific table
  router.post(
    "/:restaurantId/generate",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    rateLimit({ keyPrefix: "qr:generate", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = qrGenerateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: parsed.error.errors,
        });
      }

      const { type, tableId } = parsed.data;

      if (type === "TABLE") {
        if (!tableId) {
          return res.status(400).json({
            message: "tableId is required for TABLE type QR generation",
          });
        }
        const qrData = await generateTableQR(restaurantId, tableId);
        return res.json(qrData);
      } else {
        const qrData = await generateRestaurantQR(restaurantId);
        return res.json(qrData);
      }
    })
  );

  // Batch generate QR codes for all tables
  router.post(
    "/:restaurantId/generate-all",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    rateLimit({ keyPrefix: "qr:generate-all", windowSeconds: 60, max: 10 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const qrCodes = await generateAllTableQRs(restaurantId);
      res.json({
        restaurantId,
        totalGenerated: qrCodes.length,
        qrCodes,
      });
    })
  );

  // Get QR code for a specific table
  router.get(
    "/:restaurantId/tables/:tableId",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    rateLimit({ keyPrefix: "qr:get-table", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, tableId } = req.params;
      const qrData = await generateTableQR(restaurantId, tableId);
      res.json(qrData);
    })
  );

  // Get QR code statistics
  router.get(
    "/:restaurantId/stats",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    rateLimit({ keyPrefix: "qr:stats", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const stats = await getQRStats(restaurantId);
      res.json(stats);
    })
  );

  // Update table QR code payload (regenerate)
  router.put(
    "/:restaurantId/update-payload",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    rateLimit({ keyPrefix: "qr:update-payload", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = qrUpdatePayloadSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: parsed.error.errors,
        });
      }

      const { tableId, payload } = parsed.data;
      const table = await updateTableQRPayload(restaurantId, tableId, payload);
      
      if (!table) {
        return res.status(404).json({ message: "Table not found" });
      }

      res.json({
        table,
        message: "QR code payload updated successfully",
      });
    })
  );

  app.use("/api/qr", router);
}
