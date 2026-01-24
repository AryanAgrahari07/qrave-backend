import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import { createTestPool, cleanDatabase, closePool } from "../utils/db.js";
import { generateTestToken, getAuthHeaders } from "../utils/auth.js";
import { fixtures } from "../utils/fixtures.js";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  restaurants,
  menuItems,
  menuCategories,
  orders,
  tables,
} from "../../shared/schema.js";
import { registerOrderRoutes } from "../../src/order/routes.js";
import { requireAuth } from "../../src/middleware/auth.js";

describe("Order API - Integration Tests", () => {
  let app;
  let pool;
  let db;
  let restaurantId;
  let categoryId;
  let menuItemId;
  let tableId;
  let authToken;
  let dbAvailable = false;

  beforeAll(async () => {
    // Skip if database not configured
    if (process.env.SKIP_TESTS_NO_DB === "true") {
      console.log("⚠️  Skipping tests - TEST_DATABASE_URL not configured");
      dbAvailable = false;
      return;
    }
    
    const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    
    if (!testDbUrl) {
      console.log("⚠️  Skipping tests - TEST_DATABASE_URL not configured");
      dbAvailable = false;
      return;
    }
    
    try {
      pool = createTestPool();
      db = drizzle(pool);
      // Test connection
      await pool.query("SELECT 1");
      await cleanDatabase(pool);
      dbAvailable = true;

      // Setup Express app with routes
      app = express();
      app.use(express.json());
      
      // Mock auth middleware - set user before routes
      app.use("/api/restaurants/:restaurantId/orders", (req, res, next) => {
        // Mock auth middleware for tests
        req.user = {
          id: "test-user-id",
          email: "test@example.com",
          role: "owner",
          restaurantId: req.params.restaurantId,
        };
        next();
      });
      
      registerOrderRoutes(app);
    } catch (error) {
      console.warn(`⚠️  Database connection failed: ${error.message}`);
      console.warn("   Tests will be skipped. Set TEST_DATABASE_URL to run tests.");
      dbAvailable = false;
      if (pool) {
        try {
          await closePool(pool);
        } catch {
          // Ignore cleanup errors
        }
        pool = null;
      }
    }
  });

  afterAll(async () => {
    if (pool) {
      await closePool(pool);
    }
  });

  beforeEach(async () => {
    if (!dbAvailable || !pool || !db) return;
    
    await cleanDatabase(pool);

    // Create test restaurant
    const restaurant = fixtures.restaurant();
    restaurantId = restaurant.id;
    await db.insert(restaurants).values(restaurant);

    // Create menu category
    const category = fixtures.menuCategory(restaurantId);
    categoryId = category.id;
    await db.insert(menuCategories).values(category);

    // Create menu item
    const item = fixtures.menuItem(restaurantId, categoryId, { price: "10.00" });
    menuItemId = item.id;
    await db.insert(menuItems).values(item);

    // Create table
    const table = fixtures.table(restaurantId);
    tableId = table.id;
    await db.insert(tables).values(table);

    // Generate auth token
    authToken = generateTestToken({ restaurantId, role: "owner" });
  });

  describe("POST /api/restaurants/:restaurantId/orders", () => {
    it("should create a new order", async () => {
      if (!dbAvailable) return;
      const response = await request(app)
        .post(`/api/restaurants/${restaurantId}/orders`)
        .set(getAuthHeaders(authToken))
        .send({
          items: [{ menuItemId, quantity: 2 }],
          orderType: "DINE_IN",
        });

      expect(response.status).toBe(201);
      expect(response.body.order).toBeDefined();
      expect(response.body.order.status).toBe("PENDING");
      expect(response.body.order.items).toHaveLength(1);
    });

    it("should return 400 for invalid order data", async () => {
      if (!dbAvailable) return;
      const response = await request(app)
        .post(`/api/restaurants/${restaurantId}/orders`)
        .set(getAuthHeaders(authToken))
        .send({
          items: [], // Empty items
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Invalid order data");
    });

    it("should create order with table assignment", async () => {
      if (!dbAvailable) return;
      const response = await request(app)
        .post(`/api/restaurants/${restaurantId}/orders`)
        .set(getAuthHeaders(authToken))
        .send({
          tableId,
          items: [{ menuItemId, quantity: 1 }],
        });

      expect(response.status).toBe(201);
      expect(response.body.order.tableId).toBe(tableId);
    });
  });

  describe("GET /api/restaurants/:restaurantId/orders", () => {
    it("should list orders with pagination", async () => {
      if (!dbAvailable) return;
      // Create test orders
      const order1 = fixtures.order(restaurantId);
      const order2 = fixtures.order(restaurantId, { status: "PREPARING" });
      await db.insert(orders).values([order1, order2]);

      const response = await request(app)
        .get(`/api/restaurants/${restaurantId}/orders`)
        .set(getAuthHeaders(authToken))
        .query({ limit: 10, offset: 0 });

      expect(response.status).toBe(200);
      expect(response.body.orders).toBeDefined();
      expect(Array.isArray(response.body.orders)).toBe(true);
    });

    it("should filter orders by status", async () => {
      if (!dbAvailable) return;
      const order1 = fixtures.order(restaurantId, { status: "PENDING" });
      const order2 = fixtures.order(restaurantId, { status: "PREPARING" });
      await db.insert(orders).values([order1, order2]);

      const response = await request(app)
        .get(`/api/restaurants/${restaurantId}/orders`)
        .set(getAuthHeaders(authToken))
        .query({ status: "PENDING" });

      expect(response.status).toBe(200);
      expect(response.body.orders.every((o) => o.status === "PENDING")).toBe(true);
    });
  });

  describe("PATCH /api/restaurants/:restaurantId/orders/:orderId/status", () => {
    it("should update order status", async () => {
      if (!dbAvailable) return;
      const order = fixtures.order(restaurantId);
      await db.insert(orders).values(order);

      const response = await request(app)
        .patch(`/api/restaurants/${restaurantId}/orders/${order.id}/status`)
        .set(getAuthHeaders(authToken))
        .send({ status: "PREPARING" });

      expect(response.status).toBe(200);
      expect(response.body.order.status).toBe("PREPARING");
    });

    it("should return 404 for non-existent order", async () => {
      if (!dbAvailable) return;
      const response = await request(app)
        .patch(`/api/restaurants/${restaurantId}/orders/non-existent-id/status`)
        .set(getAuthHeaders(authToken))
        .send({ status: "PREPARING" });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/restaurants/:restaurantId/orders/:orderId/items", () => {
    it("should add items to existing order", async () => {
      if (!dbAvailable) return;
      const order = fixtures.order(restaurantId);
      await db.insert(orders).values(order);

      const response = await request(app)
        .post(`/api/restaurants/${restaurantId}/orders/${order.id}/items`)
        .set(getAuthHeaders(authToken))
        .send({
          items: [{ menuItemId, quantity: 1 }],
        });

      expect(response.status).toBe(200);
      expect(response.body.order).toBeDefined();
    });
  });

  describe("GET /api/restaurants/:restaurantId/orders/kitchen/active", () => {
    it("should return active kitchen orders", async () => {
      if (!dbAvailable) return;
      const order1 = fixtures.order(restaurantId, { status: "PENDING" });
      const order2 = fixtures.order(restaurantId, { status: "PREPARING" });
      const order3 = fixtures.order(restaurantId, { status: "SERVED" });
      await db.insert(orders).values([order1, order2, order3]);

      const response = await request(app)
        .get(`/api/restaurants/${restaurantId}/orders/kitchen/active`)
        .set(getAuthHeaders(authToken));

      expect(response.status).toBe(200);
      expect(response.body.orders).toBeDefined();
      // Should only return PENDING and PREPARING orders
      expect(
        response.body.orders.every((o) => ["PENDING", "PREPARING"].includes(o.status))
      ).toBe(true);
    });
  });
});
