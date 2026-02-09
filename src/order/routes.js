import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  createOrder,
  getOrder,
  listOrders,
  updateOrderStatus,
  updateOrder,
  cancelOrder,
  getKitchenOrders,
  getOrderHistory,
  getOrderStats,
  addOrderItems,
  removeOrderItem,
  updatePaymentStatus,
  cancelOrderWithReason,
  closeOrder, // ✅ NEW
} from "./service.js";

const router = express.Router({ mergeParams: true });

// Validation schemas
const orderItemSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
  variantId: z.string().uuid().optional(),
  modifierIds: z.array(z.string().uuid()).optional(),
});

const createOrderSchema = z.object({
  tableId: z.string().uuid().optional(),
  guestName: z.string().max(150).optional(),
  guestPhone: z.string().max(20).optional(),
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).optional().default("DINE_IN"),
  items: z.array(orderItemSchema).min(1, "Order must have at least one item"),
  notes: z.string().optional(),
  assignedWaiterId: z.string().uuid().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "UPI", "DUE"]).optional().default("DUE"), 
  paymentStatus: z.enum(["PAID", "DUE", "PARTIALLY_PAID"]).optional().default("DUE"),
});

const updateOrderStatusSchema = z.object({
  status: z.enum(["PENDING", "PREPARING", "READY", "SERVED", "PAID", "CANCELLED"]),
});

const updateOrderSchema = z.object({
  guestName: z.string().max(150).optional(),
  guestPhone: z.string().max(20).optional(),
  notes: z.string().optional(),
  discountAmount: z.number().optional(),
});

const addItemsSchema = z.object({
  items: z.array(orderItemSchema).min(1),
});

const listOrdersQuerySchema = z.object({
  status: z.enum(["PENDING", "PREPARING", "SERVED", "PAID", "CANCELLED"]).optional(),
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).optional(),
  tableId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const updatePaymentStatusSchema = z.object({
  paymentStatus: z.enum(["DUE", "PAID", "PARTIALLY_PAID"]),
  paymentMethod: z.enum(["CASH", "CARD", "UPI", "DUE"]).optional(),
});

const cancelOrderWithReasonSchema = z.object({
  reason: z.string().min(3, "Cancel reason must be at least 3 characters").max(500),
});

export function registerOrderRoutes(app) {
  app.use(
    "/api/restaurants/:restaurantId/orders",
    requireAuth,
    router
  );

  // Create new order
  router.post(
    "/",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "orders:create", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = createOrderSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid order data",
          errors: parsed.error.errors,
        });
      }

      try {
        console.log("=== Order Creation Debug ===");
        console.log("req.user:", JSON.stringify(req.user, null, 2));
        
        let placedByStaffId = null;
        
        if (parsed.data.assignedWaiterId) {
          placedByStaffId = parsed.data.assignedWaiterId;
        } else if (req.user) {
          if (req.user.staffId) {
            placedByStaffId = req.user.staffId;
          } else if (req.user.isStaff) {
            placedByStaffId = req.user.id;
          }
        }
        
        console.log("✅ Order placed by staff ID:", placedByStaffId);
        console.log("============================");
        
        const { assignedWaiterId, ...orderData } = parsed.data;
        const order = await createOrder(restaurantId, orderData, placedByStaffId);
        
        if (parsed.data.tableId && placedByStaffId && (req.user?.role === "WAITER" || req.user?.role === "ADMIN")) {
          try {
            const { assignWaiterToTable } = await import("../table/service.js");
            await assignWaiterToTable(restaurantId, parsed.data.tableId, placedByStaffId);
          } catch (err) {
            console.error("Failed to auto-assign waiter:", err);
          }
        }
        
        const enrichedOrder = await getOrder(restaurantId, order.id);
        res.status(201).json({ order: enrichedOrder });
      } catch (error) {
        console.error("Order creation error:", error);
        res.status(400).json({
          message: error.message || "Failed to create order",
        });
      }
    })
  );

  // List orders with filters and pagination
  router.get(
    "/",
    requireRole("owner", "admin", "platform_admin", "WAITER", "KITCHEN"),
    rateLimit({ keyPrefix: "orders:list", windowSeconds: 60, max: 200 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = listOrdersQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid query parameters",
          errors: parsed.error.errors,
        });
      }

      const filters = { ...parsed.data };
      if (req.user?.role === "WAITER" && req.user?.staffId) {
        filters.placedByStaffId = req.user.staffId;
        filters.excludePaid = true;
      } else if (req.user?.role === "WAITER") {
        return res.json({ 
          orders: [],
          pagination: {
            total: 0,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
            hasMore: false,
            totalPages: 0,
            currentPage: 1,
          }
        });
      }

      const result = await listOrders(restaurantId, filters);
      
      const total = result.total || 0;
      const limit = parsed.data.limit;
      const offset = parsed.data.offset;
      const hasMore = offset + limit < total;
      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.floor(offset / limit) + 1;

      res.json({
        orders: result.orders,
        pagination: {
          total,
          limit,
          offset,
          hasMore,
          totalPages,
          currentPage,
        },
      });
    })
  );

  // Get specific order
  router.get(
    "/:orderId",
    requireRole("owner", "admin", "platform_admin", "WAITER", "KITCHEN"),
    rateLimit({ keyPrefix: "orders:get", windowSeconds: 60, max: 200 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const order = await getOrder(restaurantId, orderId);

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.json({ order });
    })
  );

  // Update order status
  router.patch(
    "/:orderId/status",
    requireRole("owner", "admin", "platform_admin", "WAITER", "KITCHEN"),
    rateLimit({ keyPrefix: "orders:status", windowSeconds: 60, max: 300 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const parsed = updateOrderStatusSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid status",
          errors: parsed.error.errors,
        });
      }

      const order = await updateOrderStatus(
        restaurantId,
        orderId,
        parsed.data.status
      );

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.json({ order });
    })
  );

  // Update order (partial update)
  router.put(
    "/:orderId",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "orders:update", windowSeconds: 60, max: 200 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const parsed = updateOrderSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid update data",
          errors: parsed.error.errors,
        });
      }

      const order = await updateOrder(restaurantId, orderId, parsed.data);

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.json({ order });
    })
  );

  // Cancel order
  router.post(
    "/:orderId/cancel",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "orders:cancel", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const order = await cancelOrder(restaurantId, orderId);

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.json({ order, message: "Order cancelled successfully" });
    })
  );

  // Add items to existing order
  router.post(
    "/:orderId/items",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "orders:add-items", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const parsed = addItemsSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid items data",
          errors: parsed.error.errors,
        });
      }

      try {
        const result = await addOrderItems(
          restaurantId,
          orderId,
          parsed.data.items
        );
        res.json(result);
      } catch (error) {
        console.error("Add items error:", error);
        res.status(400).json({
          message: error.message || "Failed to add items",
        });
      }
    })
  );

  // Remove item from order
  router.delete(
    "/:orderId/items/:orderItemId",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "orders:remove-item", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId, orderItemId } = req.params;

      try {
        const result = await removeOrderItem(restaurantId, orderId, orderItemId);
        res.json(result);
      } catch (error) {
        console.error("Remove item error:", error);
        res.status(400).json({
          message: error.message || "Failed to remove item",
        });
      }
    })
  );

  // Get order history
  router.get(
    "/history/all",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "orders:history", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const { limit, offset, fromDate, toDate } = req.query;

      const result = await getOrderHistory(restaurantId, {
        limit: limit ? parseInt(limit) : 50,
        offset: offset ? parseInt(offset) : 0,
        fromDate,
        toDate,
      });

      res.json(result);
    })
  );

  // Get order statistics
  router.get(
    "/stats/summary",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "orders:stats", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const { fromDate, toDate } = req.query;

      const stats = await getOrderStats(restaurantId, {
        fromDate,
        toDate,
      });

      res.json({ stats });
    })
  );

  // === Kitchen Display System (KDS) Endpoints ===

  // Get active kitchen orders
  router.get(
    "/kitchen/active",
    requireRole("owner", "admin", "platform_admin", "KITCHEN", "WAITER"),
    rateLimit({ keyPrefix: "orders:kitchen", windowSeconds: 10, max: 600 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const orders = await getKitchenOrders(restaurantId);
      res.json({ orders });
    })
  );

  // Mark order as preparing
  router.post(
    "/:orderId/kitchen/start",
    requireRole("owner", "admin", "platform_admin", "KITCHEN"),
    rateLimit({ keyPrefix: "orders:kitchen-start", windowSeconds: 60, max: 300 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const order = await updateOrderStatus(restaurantId, orderId, "PREPARING");

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.json({ order, message: "Order marked as preparing" });
    })
  );

  // Mark order as ready
  router.post(
    "/:orderId/kitchen/complete",
    requireRole("owner", "admin", "platform_admin", "KITCHEN"),
    rateLimit({ keyPrefix: "orders:kitchen-complete", windowSeconds: 60, max: 300 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const order = await updateOrderStatus(restaurantId, orderId, "READY");

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.json({ order, message: "Order marked as ready for pickup" });
    })
  );

  // Update payment status
  router.patch(
    "/:orderId/payment-status",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "orders:payment-status", windowSeconds: 60, max: 200 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const parsed = updatePaymentStatusSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid payment status data",
          errors: parsed.error.errors,
        });
      }

      try {
        const order = await updatePaymentStatus(
          restaurantId,
          orderId,
          parsed.data.paymentStatus,
          parsed.data.paymentMethod
        );

        if (!order) {
          return res.status(404).json({ message: "Order not found" });
        }

        res.json({ 
          order,
          message: `Payment status updated to ${parsed.data.paymentStatus}` 
        });
      } catch (error) {
        console.error("Payment status update error:", error);
        res.status(400).json({
          message: error.message || "Failed to update payment status",
        });
      }
    })
  );

  // Cancel order with reason
  router.post(
    "/:orderId/cancel-with-reason",
    requireRole("owner", "admin", "platform_admin", "WAITER"),
    rateLimit({ keyPrefix: "orders:cancel-reason", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;
      const parsed = cancelOrderWithReasonSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid cancel data",
          errors: parsed.error.errors,
        });
      }

      try {
        const order = await cancelOrderWithReason(
          restaurantId,
          orderId,
          parsed.data.reason
        );

        if (!order) {
          return res.status(404).json({ message: "Order not found" });
        }

        res.json({ 
          order, 
          message: "Order cancelled successfully" 
        });
      } catch (error) {
        console.error("Cancel order error:", error);
        res.status(400).json({
          message: error.message || "Failed to cancel order",
        });
      }
    })
  );

  // ✅ NEW: Close order (mark as complete)
  router.post(
    "/:orderId/close",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "orders:close", windowSeconds: 60, max: 100 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, orderId } = req.params;

      try {
        const order = await closeOrder(restaurantId, orderId);

        if (!order) {
          return res.status(404).json({ message: "Order not found" });
        }

        res.json({ 
          order, 
          message: "Order closed successfully. New orders for this table will create a fresh order." 
        });
      } catch (error) {
        console.error("Close order error:", error);
        res.status(400).json({
          message: error.message || "Failed to close order",
        });
      }
    })
  );

  app.use("/api/restaurants/:restaurantId/orders", router);
}