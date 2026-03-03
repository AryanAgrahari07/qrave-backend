import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { 
  getCurrentSubscription, 
  createSubscriptionOrder, 
  verifyPaymentAndActivate, 
  getSubscriptionHistory,
  getAvailablePlans
} from "./service.js";
import { env } from "../config/env.js";

const router = express.Router();

export function registerSubscriptionRoutes(app) {
  // Get available plans and pricing
  router.get(
    "/plans",
    (req, res) => {
      res.json(getAvailablePlans());
    }
  );

  // Get current status
  router.get(
    "/:restaurantId/current",
    requireAuth,
    asyncHandler(async (req, res) => {
      const sub = await getCurrentSubscription(req.params.restaurantId);
      res.json(sub);
    })
  );

  // Create order
  router.post(
    "/:restaurantId/create-order",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { plan } = req.body;
      if (!plan) return res.status(400).json({ message: "Plan is required" });
      const order = await createSubscriptionOrder(req.params.restaurantId, plan);
      res.json({ ...order, keyId: env.razorpayKeyId || "test_key" });
    })
  );

  // Verify
  router.post(
    "/:restaurantId/verify-payment",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(400).json({ message: "Missing Razorpay fields" });
      }
      const result = await verifyPaymentAndActivate(
        req.params.restaurantId, 
        razorpayOrderId, 
        razorpayPaymentId, 
        razorpaySignature
      );
      res.json(result);
    })
  );

  // History
  router.get(
    "/:restaurantId/history",
    requireAuth,
    asyncHandler(async (req, res) => {
      const history = await getSubscriptionHistory(req.params.restaurantId);
      res.json(history);
    })
  );

  app.use("/api/subscriptions", router);
}
