import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  createTransaction,
  listTransactions,
  getTransaction,
  exportTransactionsCSV,
  getRecentTransactionsSummary,
} from "./service.js";

const router = express.Router({ mergeParams: true });

const createTransactionSchema = z.object({
  orderId: z.string().uuid(),
  billNumber: z.string().min(1).max(50),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "WALLET", "OTHER"]),
  paymentReference: z.string().max(100).optional(),
  combinedSubtotal: z.number().optional(),
  combinedGst: z.number().optional(),
  combinedService: z.number().optional(),
  combinedTotal: z.number().optional(),
});

const listTransactionsQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "WALLET", "OTHER"]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const exportCSVQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "WALLET", "OTHER"]).optional(),
});

export function registerTransactionRoutes(app) {
  app.use(
    "/api/restaurants/:restaurantId/transactions",
    requireAuth,
    router
  );

  // Create transaction (when order is paid)
  router.post(
    "/",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "transactions:create", windowSeconds: 60, max: 200 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = createTransactionSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid transaction data",
          errors: parsed.error.errors,
        });
      }

      try {
        const transaction = await createTransaction(restaurantId, parsed.data.orderId, parsed.data);
        res.status(201).json({ transaction });
      } catch (error) {
        console.error("Transaction creation error:", error);
        res.status(400).json({
          message: error.message || "Failed to create transaction",
        });
      }
    })
  );

  // List transactions with pagination and search
  router.get(
    "/",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "transactions:list", windowSeconds: 60, max: 200 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = listTransactionsQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid query parameters",
          errors: parsed.error.errors,
        });
      }

      const result = await listTransactions(restaurantId, parsed.data);
      res.json(result);
    })
  );

  // Export transactions as CSV
  router.get(
    "/export/csv",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "transactions:export", windowSeconds: 60, max: 10 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = exportCSVQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid query parameters",
          errors: parsed.error.errors,
        });
      }

      const rows = await exportTransactionsCSV(restaurantId, parsed.data);

      // Generate CSV
      const headers = [
        'Bill Number',
        'Date & Time',
        'Table/Guest',
        'Payment Method',
        'Subtotal',
        'GST',
        'Service Tax',
        'Discount',
        'Grand Total'
      ];

      const csvRows = [
        headers.join(','),
        ...rows.map(row => [
          `"${row.bill_number}"`,
          `"${new Date(row.paid_at).toLocaleString()}"`,
          `"${row.table_or_guest}"`,
          row.payment_method,
          row.subtotal,
          row.gst_amount,
          row.service_tax_amount,
          row.discount_amount,
          row.grand_total,
        ].join(','))
      ];

      const csv = csvRows.join('\n');

      // Set headers for file download
      const filename = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    })
  );

  router.get(
      "/recent",
      requireRole("owner", "admin", "platform_admin", "WAITER"),
      rateLimit({ keyPrefix: "transactions:recent", windowSeconds: 60, max: 200 }),
      asyncHandler(async (req, res) => {
        const { restaurantId } = req.params;
        const limit = parseInt(req.query.limit) || 5;

        const recentTransactions = await getRecentTransactionsSummary(restaurantId, limit);
        res.json({ transactions: recentTransactions });
      })
    );

  // Get specific transaction
  router.get(
    "/:transactionId",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "transactions:get", windowSeconds: 60, max: 200 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, transactionId } = req.params;
      const transaction = await getTransaction(restaurantId, transactionId);

      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }

      res.json({ transaction });
    })
  );
}