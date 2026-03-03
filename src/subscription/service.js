import Razorpay from "razorpay";
import crypto from "crypto";
import { pool } from "../dbClient.js";
import { env } from "../config/env.js";

// Export the singleton
export const razorpay = new Razorpay({
  key_id: env.razorpayKeyId || "test_key",
  key_secret: env.razorpayKeySecret || "test_secret",
});

const PLANS = {
  STARTER: { amount: env.planStarterPrice, days: 30 },
  PRO: { amount: env.planProPrice, days: 30 },
  ENTERPRISE: { amount: env.planEnterprisePrice, days: 30 },
};

export function getAvailablePlans() {
  return PLANS;
}

export async function getCurrentSubscription(restaurantId) {
  const result = await pool.query(
    `SELECT plan, subscription_valid_until AS "subscriptionValidUntil", subscription_status AS "subscriptionStatus"
     FROM restaurants WHERE id = $1`,
    [restaurantId]
  );
  return result.rows[0];
}

export async function createSubscriptionOrder(restaurantId, planId) {
  const plan = PLANS[planId];
  if (!plan) throw new Error("Invalid plan");

  // Create Razorpay order
  const options = {
    amount: plan.amount * 100, // in paise
    currency: "INR",
    receipt: `rcpt_${restaurantId.split('-')[0]}_${Date.now()}`.substring(0, 40),
  };

  let order;
  try {
    order = await razorpay.orders.create(options);
  } catch (err) {
    if ((env.razorpayKeyId || "test_key") === "test_key" || !env.razorpayKeyId.startsWith("rzp_")) {
      // Mock order for dev if Razorpay fails without real keys
      order = { id: `mock_order_${Date.now()}` };
    } else {
      console.error("Razorpay order creation failed:", err);
      throw err;
    }
  }

  // Record in DB
  const result = await pool.query(
    `INSERT INTO subscriptions (restaurant_id, plan, amount, currency, end_date, razorpay_order_id, status)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 || ' days')::interval, $6, 'PENDING')
     RETURNING id, razorpay_order_id AS "razorpayOrderId", amount, currency`,
    [restaurantId, planId, plan.amount, "INR", plan.days, order.id]
  );

  return result.rows[0];
}

export async function verifyPaymentAndActivate(restaurantId, razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  const keySecret = env.razorpayKeySecret || "test_secret";
  
  if (keySecret !== "test_secret" && !razorpayOrderId.startsWith("mock_")) {
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      await pool.query(
        `UPDATE subscriptions SET status = 'FAILED', failure_reason = 'Invalid signature' WHERE razorpay_order_id = $1`,
        [razorpayOrderId]
      );
      throw new Error("Invalid payment signature");
    }
  }

  // Update subscription record
  const subResult = await pool.query(
    `UPDATE subscriptions 
     SET status = 'ACTIVE', razorpay_payment_id = $1, razorpay_signature = $2 
     WHERE razorpay_order_id = $3 AND status = 'PENDING'
     RETURNING id, plan, end_date AS "endDate"`,
    [razorpayPaymentId, razorpaySignature, razorpayOrderId]
  );
  
  if (subResult.rows.length === 0) {
    throw new Error("Subscription order not found or already processed");
  }

  const sub = subResult.rows[0];

  // Extend restaurant's validity
  const restResult = await pool.query(
    `SELECT subscription_valid_until AS "validUntil" FROM restaurants WHERE id = $1`,
    [restaurantId]
  );
  const currentValid = restResult.rows[0]?.validUntil;
  
  let newValidUntil;
  if (!currentValid || new Date(currentValid) < new Date()) {
    const days = PLANS[sub.plan]?.days || 30;
    const d = new Date();
    d.setDate(d.getDate() + days);
    newValidUntil = d;
  } else {
    // Append
    const days = PLANS[sub.plan]?.days || 30;
    const d = new Date(currentValid);
    d.setDate(d.getDate() + days);
    newValidUntil = d;
  }

  await pool.query(
    `UPDATE restaurants 
     SET subscription_valid_until = $1, subscription_status = 'ACTIVE', plan = $2
     WHERE id = $3`,
    [newValidUntil, sub.plan, restaurantId]
  );

  return { success: true, validUntil: newValidUntil };
}

export async function getSubscriptionHistory(restaurantId) {
  const result = await pool.query(
    `SELECT id, plan, amount, currency, start_date AS "startDate", end_date AS "endDate", status, created_at AS "createdAt"
     FROM subscriptions 
     WHERE restaurant_id = $1
     ORDER BY created_at DESC`,
    [restaurantId]
  );
  return result.rows;
}
