import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getAnalyticsSummary } from "./service.js";

const router = express.Router();

export function registerAnalyticsRoutes(app) {
  // Get analytics summary for a restaurant
  router.get(
    "/:restaurantId/summary",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const { timeframe = "day" } = req.query;

      // Validate timeframe
      const validTimeframes = ["day", "month", "quarter", "year"];
      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({ 
          message: "Invalid timeframe. Must be one of: day, month, quarter, year" 
        });
      }

      const analytics = await getAnalyticsSummary(restaurantId, timeframe);
      res.json({ analytics });
    })
  );

  app.use("/api/analytics", router);
}