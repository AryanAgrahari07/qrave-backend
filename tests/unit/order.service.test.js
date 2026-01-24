import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { createTestPool, cleanDatabase, closePool } from "../utils/db.js";
import { createOrder, getOrder, updateOrderStatus, addOrderItems } from "../../src/order/service.js";
import { fixtures } from "../utils/fixtures.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { restaurants, menuItems, menuCategories, orders, orderItems, tables } from "../../shared/schema.js";

let pool;
let db;
let restaurantId;
let categoryId;
let menuItemId1;
let menuItemId2;
let dbAvailable = false;

describe("Order Service - Unit Tests", () => {
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
    if (!dbAvailable || !pool || !db) {
      return; // Skip test setup if DB not available
    }
    
    try {
      await cleanDatabase(pool);

      // Create test restaurant FIRST (required for foreign keys)
      const restaurant = fixtures.restaurant();
      restaurantId = restaurant.id;
      await db.insert(restaurants).values(restaurant);

      // Create menu category SECOND (depends on restaurant)
      const category = fixtures.menuCategory(restaurantId);
      categoryId = category.id;
      await db.insert(menuCategories).values(category);

      // Create menu items THIRD (depends on restaurant and category)
      const item1 = fixtures.menuItem(restaurantId, categoryId, { price: "10.00" });
      const item2 = fixtures.menuItem(restaurantId, categoryId, { price: "20.00" });
      menuItemId1 = item1.id;
      menuItemId2 = item2.id;
      await db.insert(menuItems).values([item1, item2]);
    } catch (error) {
      console.error("Test setup failed:", error.message);
      throw error;
    }
  });

  describe("createOrder", () => {
    it("should create an order with correct tax calculation", async () => {
      if (!dbAvailable) {
        console.log("⏭️  Skipping - database not available");
        return;
      }
      const orderData = {
        items: [
          { menuItemId: menuItemId1, quantity: 2 },
          { menuItemId: menuItemId2, quantity: 1 },
        ],
        orderType: "DINE_IN",
      };

      const order = await createOrder(restaurantId, orderData);

      expect(order).toBeDefined();
      expect(order.status).toBe("PENDING");
      expect(order.orderType).toBe("DINE_IN");
      
      // Subtotal: (10 * 2) + (20 * 1) = 40
      expect(parseFloat(order.subtotalAmount)).toBe(40.00);
      
      // GST: 40 * 0.05 = 2
      expect(parseFloat(order.gstAmount)).toBe(2.00);
      
      // Service Tax: 40 * 0.10 = 4
      expect(parseFloat(order.serviceTaxAmount)).toBe(4.00);
      
      // Total: 40 + 2 + 4 = 46
      expect(parseFloat(order.totalAmount)).toBe(46.00);
      
      expect(order.items).toHaveLength(2);
    });

    it("should throw error for non-existent menu item", async () => {
      if (!dbAvailable) return;
      const orderData = {
        items: [{ menuItemId: "non-existent-id", quantity: 1 }],
      };

      await expect(createOrder(restaurantId, orderData)).rejects.toThrow();
    });

    it("should create order with table assignment", async () => {
      if (!dbAvailable) return;
      // Restaurant must exist first (created in beforeEach)
      const table = fixtures.table(restaurantId);
      await db.insert(tables).values(table);

      const orderData = {
        tableId: table.id,
        items: [{ menuItemId: menuItemId1, quantity: 1 }],
      };

      const order = await createOrder(restaurantId, orderData);
      expect(order.tableId).toBe(table.id);
    });
  });

  describe("getOrder", () => {
    it("should retrieve order with items", async () => {
      if (!dbAvailable) return;
      const orderData = {
        items: [{ menuItemId: menuItemId1, quantity: 1 }],
      };

      const created = await createOrder(restaurantId, orderData);
      const retrieved = await getOrder(restaurantId, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.items).toHaveLength(1);
    });

    it("should return null for non-existent order", async () => {
      if (!dbAvailable) return;
      const result = await getOrder(restaurantId, "non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("updateOrderStatus", () => {
    it("should update order status correctly", async () => {
      if (!dbAvailable) return;
      const orderData = {
        items: [{ menuItemId: menuItemId1, quantity: 1 }],
      };

      const order = await createOrder(restaurantId, orderData);
      const updated = await updateOrderStatus(restaurantId, order.id, "PREPARING");

      expect(updated.status).toBe("PREPARING");
      expect(updated.id).toBe(order.id);
    });

    it("should set closedAt when status is PAID", async () => {
      if (!dbAvailable) return;
      const orderData = {
        items: [{ menuItemId: menuItemId1, quantity: 1 }],
      };

      const order = await createOrder(restaurantId, orderData);
      const updated = await updateOrderStatus(restaurantId, order.id, "PAID");

      expect(updated.status).toBe("PAID");
      expect(updated.closedAt).toBeDefined();
    });
  });

  describe("addOrderItems", () => {
    it("should add items to existing order and recalculate totals", async () => {
      if (!dbAvailable) return;
      const orderData = {
        items: [{ menuItemId: menuItemId1, quantity: 1 }],
      };

      const order = await createOrder(restaurantId, orderData);
      const originalTotal = parseFloat(order.totalAmount);

      const result = await addOrderItems(restaurantId, order.id, [
        { menuItemId: menuItemId2, quantity: 2 },
      ]);

      expect(result.order.items).toHaveLength(2);
      expect(parseFloat(result.order.totalAmount)).toBeGreaterThan(originalTotal);
    });
  });
});
