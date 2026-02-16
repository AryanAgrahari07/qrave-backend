import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getAnalyticsOverview, getAnalyticsSummary } from "./service.js";

const router = express.Router();

const validTimeframes = ["day", "month", "quarter", "year"];

export function registerAnalyticsRoutes(app) {
  // Recommended endpoint: rich overview payload for dashboards
  router.get(
    "/:restaurantId/overview",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const { timeframe = "day", timezone } = req.query;

      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({
          message: "Invalid timeframe. Must be one of: day, month, quarter, year",
        });
      }

      const analytics = await getAnalyticsOverview(restaurantId, timeframe, { timeZone: timezone });
      res.json({ analytics });
    })
  );

  // Backwards-compatible endpoint
  router.get(
    "/:restaurantId/summary",
    requireAuth,
    requireRole("owner", "platform_admin", "admin"),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const { timeframe = "day", timezone } = req.query;

      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({
          message: "Invalid timeframe. Must be one of: day, month, quarter, year",
        });
      }

      const analytics = await getAnalyticsSummary(restaurantId, timeframe, { timeZone: timezone });
      res.json({ analytics });
    })
  );

  app.use("/api/analytics", router);
}
