import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { env } from "../../src/config/env.js";

/**
 * Create a test database connection pool
 */
export function createTestPool() {
  const testDbUrl = process.env.TEST_DATABASE_URL || env.databaseUrl?.replace(/\/[^/]+$/, "/qrave_test");
  
  if (!testDbUrl) {
    throw new Error("TEST_DATABASE_URL or DATABASE_URL must be set for tests");
  }

  return new Pool({
    connectionString: testDbUrl,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 2000,
  });
}

/**
 * Tables in FK-safe delete order: children first, parents last.
 * (Referencing rows must be deleted before referenced rows.)
 */
const DELETE_ORDER = [
  "order_items",      // refs: orders, menu_items, restaurants
  "transactions",     // refs: orders, restaurants
  "analytics_events", // refs: restaurants, tables, orders, menu_items
  "orders",           // refs: restaurants, tables
  "guest_queue",      // refs: restaurants
  "inventory_items",  // refs: restaurants
  "staff",            // refs: restaurants
  "menu_items",       // refs: restaurants, menu_categories
  "tables",           // refs: restaurants
  "menu_categories",  // refs: restaurants
  "restaurants",      // refs: users
  "users",
];

/**
 * Clean database tables (delete all data)
 * Used for test isolation
 * Uses DELETE in FK-safe order instead of TRUNCATE to avoid deadlocks
 */
export async function cleanDatabase(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_drizzle%'
    `);
    const existingSet = new Set(existing.rows.map((r) => r.tablename));

    for (const table of DELETE_ORDER) {
      if (!existingSet.has(table)) continue;
      await client.query(`DELETE FROM "${table}"`);
    }

    // Reset identity sequences (e.g. analytics_events.id)
    for (const table of DELETE_ORDER) {
      if (!existingSet.has(table)) continue;
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), 1, false)`
        );
      } catch {
        // no serial "id" (e.g. uuid pk)
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Close database connection pool
 */
export async function closePool(pool) {
  await pool.end();
}

/**
 * Execute a raw SQL query (useful for test setup)
 */
export async function executeSql(pool, query) {
  return pool.query(query);
}
