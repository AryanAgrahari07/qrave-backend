import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { 
  getDashboardSummary,
  getTableStats,
  getOrderStats,
  getQueueStats,
  getWeeklyScanActivity,
  getRecentOrders
} from "./service.js";

const router = express.Router();

export function registerDashboardRoutes(app) {
  // Get complete dashboard summary
  router.get(
    "/:restaurantId/summary",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
    //   const restaurantId = req.user.restaurantId;
    const { restaurantId } = req.params;
      if (!restaurantId) {
        return res.status(400).json({ 
          message: "No restaurant associated with user" 
        });
      }

      const summary = await getDashboardSummary(restaurantId);
      res.json(summary);
    })
  );

  // Get table stats only
  router.get(
    "/:restaurantId/tables",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
    //   const restaurantId = req.user.restaurantId;
    const { restaurantId } = req.params;
      if (!restaurantId) {
        return res.status(400).json({ 
          message: "No restaurant associated with user" 
        });
      }

      const stats = await getTableStats(restaurantId);
      res.json(stats);
    })
  );

  // Get order stats only
  router.get(
    "/:restaurantId/orders",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
    //   const restaurantId = req.user.restaurantId;
    const { restaurantId } = req.params;
      if (!restaurantId) {
        return res.status(400).json({ 
          message: "No restaurant associated with user" 
        });
      }

      const stats = await getOrderStats(restaurantId);
      res.json(stats);
    })
  );

  // Get queue stats only
  router.get(
    "/:restaurantId/queue",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
    //   const restaurantId = req.user.restaurantId;
    const { restaurantId } = req.params;
      if (!restaurantId) {
        return res.status(400).json({ 
          message: "No restaurant associated with user" 
        });
      }

      const stats = await getQueueStats(restaurantId);
      res.json(stats);
    })
  );

  // Get scan activity
  router.get(
    "/:restaurantId/scan-activity",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
    //   const restaurantId = req.user.restaurantId;
    const { restaurantId } = req.params;
      if (!restaurantId) {
        return res.status(400).json({ 
          message: "No restaurant associated with user" 
        });
      }

      const activity = await getWeeklyScanActivity(restaurantId);
      res.json(activity);
    })
  );

  // Get recent orders
  router.get(
    "/:restaurantId/recent-orders",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
    //   const restaurantId = req.user.restaurantId;
      const { restaurantId } = req.params;
      const { limit = 5 } = req.query;
      
      if (!restaurantId) {
        return res.status(400).json({ 
          message: "No restaurant associated with user" 
        });
      }

      const orders = await getRecentOrders(restaurantId, parseInt(limit));
      res.json(orders);
    })
  );

  app.use("/api/dashboard", router);
}