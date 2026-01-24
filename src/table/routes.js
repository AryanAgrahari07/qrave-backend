import express from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  listTables,
  getTable,
  createTable,
  updateTable,
  deleteTable,
  updateTableStatus,
} from "./service.js";

const router = express.Router({ mergeParams: true });

const tableCreateSchema = z.object({
  tableNumber: z.string().min(1).max(50),
  capacity: z.number().int().positive(),
  floorSection: z.string().max(100).optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  qrCodePayload: z.string().min(1),
  currentStatus: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "BLOCKED"]).optional(),
});

const tableUpdateSchema = tableCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const tableStatusSchema = z.object({
  status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "BLOCKED"]),
});

export function registerTableRoutes(app) {
  // Tables scoped to a restaurant
  // Allow staff (WAITER, KITCHEN) to view tables, but only owners/admins can modify
  app.use(
    "/api/restaurants/:restaurantId/tables",
    requireAuth,
    requireRole("owner", "platform_admin", "admin", "WAITER", "KITCHEN"),
    router
  );

  // List all tables
  router.get(
    "/",
    rateLimit({ keyPrefix: "tables:list", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const tablesList = await listTables(restaurantId);
      res.json({ tables: tablesList });
    })
  );

  // Get specific table
  router.get(
    "/:tableId",
    rateLimit({ keyPrefix: "tables:get", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, tableId } = req.params;
      const table = await getTable(restaurantId, tableId);
      if (!table) {
        return res.status(404).json({ message: "Table not found" });
      }
      res.json({ table });
    })
  );

  // Create new table (owners/admins only)
  router.post(
    "/",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "tables:create", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId } = req.params;
      const parsed = tableCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: parsed.error.errors,
        });
      }
      const table = await createTable(restaurantId, parsed.data);
      res.status(201).json({ table });
    })
  );

  // Update table (owners/admins only)
  router.put(
    "/:tableId",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "tables:update", windowSeconds: 60, max: 120 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, tableId } = req.params;
      const parsed = tableUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: parsed.error.errors,
        });
      }
      const table = await updateTable(restaurantId, tableId, parsed.data);
      if (!table) {
        return res.status(404).json({ message: "Table not found" });
      }
      res.json({ table });
    })
  );

  // Delete table (soft delete, owners/admins only)
  router.delete(
    "/:tableId",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "tables:delete", windowSeconds: 60, max: 60 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, tableId } = req.params;
      const table = await deleteTable(restaurantId, tableId);
      if (!table) {
        return res.status(404).json({ message: "Table not found" });
      }
      res.json({ table, deleted: true });
    })
  );

  // Update table status (for quick status changes from floor map)
  router.patch(
    "/:tableId/status",
    rateLimit({ keyPrefix: "tables:status", windowSeconds: 60, max: 300 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, tableId } = req.params;
      const parsed = tableStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: parsed.error.errors,
        });
      }
      
      // Auto-assign waiter if they're marking table as OCCUPIED
      const staffId = req.user?.role === "WAITER" || req.user?.role === "ADMIN" 
        ? req.user.id 
        : null;
      
      const table = await updateTableStatus(
        restaurantId,
        tableId,
        parsed.data.status,
        staffId
      );
      if (!table) {
        return res.status(404).json({ message: "Table not found" });
      }
      res.json({ table });
    })
  );

  // Assign waiter to table (admin can manually assign)
  router.patch(
    "/:tableId/assign-waiter",
    requireRole("owner", "admin", "platform_admin"),
    rateLimit({ keyPrefix: "tables:assign", windowSeconds: 60, max: 300 }),
    asyncHandler(async (req, res) => {
      const { restaurantId, tableId } = req.params;
      const { staffId } = req.body;
      
      // Allow null to unassign waiter
      if (staffId === undefined) {
        return res.status(400).json({ message: "staffId is required (can be null to unassign)" });
      }
      
      const { assignWaiterToTable } = await import("./service.js");
      const table = await assignWaiterToTable(restaurantId, tableId, staffId || null);
      if (!table) {
        return res.status(404).json({ message: "Table not found" });
      }
      res.json({ table });
    })
  );
}
