import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { createTestPool, cleanDatabase, closePool } from "../utils/db.js";
import {
  registerInQueue,
  getQueueEntry,
  updateQueueStatus,
  callNextGuest,
  estimateWaitTime,
} from "../../src/queue/service.js";
import { fixtures } from "../utils/fixtures.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { restaurants, guestQueue } from "../../shared/schema.js";

describe("Queue Service - Unit Tests", () => {
  let pool;
  let db;
  let restaurantId;
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
  });

  describe("registerInQueue", () => {
    it("should register guest in queue with position and wait time", async () => {
      if (!dbAvailable) return;
      const queueData = {
        guestName: "John Doe",
        partySize: 2,
        phoneNumber: "+1234567890",
      };

      const entry = await registerInQueue(restaurantId, queueData);

      expect(entry).toBeDefined();
      expect(entry.guestName).toBe("John Doe");
      expect(entry.partySize).toBe(2);
      expect(entry.status).toBe("WAITING");
      expect(entry.position).toBe(1);
      expect(entry.estimatedWaitMinutes).toBeGreaterThan(0);
    });

    it("should calculate correct position for multiple guests", async () => {
      if (!dbAvailable) return;
      await registerInQueue(restaurantId, {
        guestName: "Guest 1",
        partySize: 2,
      });

      await registerInQueue(restaurantId, {
        guestName: "Guest 2",
        partySize: 4,
      });

      const entry3 = await registerInQueue(restaurantId, {
        guestName: "Guest 3",
        partySize: 2,
      });

      expect(entry3.position).toBe(3);
    });
  });

  describe("getQueueEntry", () => {
    it("should retrieve queue entry with position", async () => {
      if (!dbAvailable) return;
      const entry = await registerInQueue(restaurantId, {
        guestName: "Test Guest",
        partySize: 2,
      });

      const retrieved = await getQueueEntry(restaurantId, entry.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(entry.id);
      expect(retrieved.position).toBeDefined();
    });

    it("should return null for non-existent entry", async () => {
      if (!dbAvailable) return;
      const result = await getQueueEntry(restaurantId, "non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("updateQueueStatus", () => {
    it("should update queue status correctly", async () => {
      if (!dbAvailable) return;
      const entry = await registerInQueue(restaurantId, {
        guestName: "Test Guest",
        partySize: 2,
      });

      const updated = await updateQueueStatus(restaurantId, entry.id, "CALLED");

      expect(updated.status).toBe("CALLED");
      expect(updated.id).toBe(entry.id);
    });
  });

  describe("callNextGuest", () => {
    it("should call the oldest waiting guest", async () => {
      if (!dbAvailable) return;
      const entry1 = await registerInQueue(restaurantId, {
        guestName: "Guest 1",
        partySize: 2,
      });

      await registerInQueue(restaurantId, {
        guestName: "Guest 2",
        partySize: 4,
      });

      const called = await callNextGuest(restaurantId);

      expect(called).toBeDefined();
      expect(called.id).toBe(entry1.id);
      expect(called.status).toBe("CALLED");
    });

    it("should return null when no guests waiting", async () => {
      if (!dbAvailable) return;
      const result = await callNextGuest(restaurantId);
      expect(result).toBeNull();
    });
  });

  describe("estimateWaitTime", () => {
    it("should estimate wait time based on position and party size", async () => {
      if (!dbAvailable) return;
      // Create some queue entries
      await registerInQueue(restaurantId, { guestName: "G1", partySize: 2 });
      await registerInQueue(restaurantId, { guestName: "G2", partySize: 4 });
      
      const entry = await registerInQueue(restaurantId, {
        guestName: "G3",
        partySize: 2,
      });

      // Wait time should be positive
      expect(entry.estimatedWaitMinutes).toBeGreaterThan(0);
    });
  });
});
