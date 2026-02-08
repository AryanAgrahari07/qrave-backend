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
  assignedWaiterId: z.string().uuid().optional(), // Optional waiter assignment when admin places order manually
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

export function registerOrderRoutes(app) {
  // Order routes scoped to restaurant
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
        // DEBUG: Log authentication info
        console.log("=== Order Creation Debug ===");
        console.log("req.user:", JSON.stringify(req.user, null, 2));
        
        // Extract staff ID from authenticated user
        // req.user can be from users table (owner, admin, platform_admin) OR staff table (WAITER, KITCHEN, ADMIN)
        // For owners/admins placing orders, save their user ID
        // For staff (waiters/kitchen), save their staff ID
        // If assignedWaiterId is provided in the request, use that instead (for admin manual assignment)
        let placedByStaffId = null;
        
        // Priority: assignedWaiterId from request > staff member's own ID
        if (parsed.data.assignedWaiterId) {
          // Admin is manually assigning order to a waiter
          placedByStaffId = parsed.data.assignedWaiterId;
        } else if (req.user) {
          // For staff members, use staffId or id
          if (req.user.staffId) {
            placedByStaffId = req.user.staffId;
          } else if (req.user.isStaff) {
            placedByStaffId = req.user.id;
          }
        }
        
        console.log("✅ Order placed by staff ID:", placedByStaffId);
       
        console.log("Final placedByStaffId:", placedByStaffId);
        console.log("============================");
        
        // Remove assignedWaiterId from data before passing to createOrder (it's handled above)
        const { assignedWaiterId, ...orderData } = parsed.data;
        const order = await createOrder(restaurantId, orderData, placedByStaffId);
        
        // Auto-assign waiter to table if they placed an order for it
        if (parsed.data.tableId && placedByStaffId && (req.user?.role === "WAITER" || req.user?.role === "ADMIN")) {
          try {
            const { assignWaiterToTable } = await import("../table/service.js");
            await assignWaiterToTable(restaurantId, parsed.data.tableId, placedByStaffId);
          } catch (err) {
            console.error("Failed to auto-assign waiter:", err);
          }
        }
        
        // Return enriched order with staff info
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

      // For WAITER role, automatically filter by their staff ID and exclude PAID orders
      const filters = { ...parsed.data };
      if (req.user?.role === "WAITER" && req.user?.staffId) {
        filters.placedByStaffId = req.user.staffId;
        filters.excludePaid = true; // Always exclude PAID orders for waiters
      } else if (req.user?.role === "WAITER") {
        // If waiter doesn't have staffId, they shouldn't see any orders
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
      
      // Calculate pagination metadata
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

  // Get order history (completed/cancelled orders)
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

  // Get active kitchen orders (PENDING, PREPARING)
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

  // Mark order as preparing (from KDS)
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

  // Mark order as ready (from KDS) - waiter will mark as SERVED
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

  app.use("/api/restaurants/:restaurantId/orders", router);
}