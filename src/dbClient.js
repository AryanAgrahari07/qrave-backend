import { drizzle } from "drizzle-orm/node-postgres";
import { createPgPool } from "./db.js";

/**
 * Singleton Postgres pool + Drizzle client.
 *
 * IMPORTANT: Do not create new pools in each module. Each pool can open up to
 * PG_POOL_MAX connections. Creating many pools will exhaust Postgres quickly
 * under load or when running multiple API instances.
 *
 * NOTE: In dev (node --watch / hot reload) and in some serverless runtimes,
 * modules can be re-evaluated. Cache the instances on globalThis to avoid
 * accidentally creating multiple pools.
 */

const g = globalThis;

/** @type {import('pg').Pool | undefined} */
const existingPool = g.__qravePool;

export const pool = existingPool ?? createPgPool();

// Persist for subsequent reloads
g.__qravePool = pool;

/** @type {ReturnType<typeof drizzle> | undefined} */
const existingDb = g.__qraveDb;

export const db = existingDb ?? drizzle(pool);

g.__qraveDb = db;
