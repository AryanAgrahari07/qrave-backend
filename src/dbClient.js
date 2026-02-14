import { drizzle } from "drizzle-orm/node-postgres";
import { createPgPool } from "./db.js";

/**
 * Singleton Postgres pool + Drizzle client.
 *
 * IMPORTANT: Do not create new pools in each module. Each pool can open up to
 * PG_POOL_MAX connections. Creating many pools will exhaust Postgres quickly
 * under load or when running multiple API instances.
 */
export const pool = createPgPool();

/**
 * Drizzle ORM client backed by the shared pool.
 */
export const db = drizzle(pool);
