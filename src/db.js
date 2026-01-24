import { Pool } from "pg";
import { env } from "./config/env.js";

/**
 * Postgres connection pooling (application-level).
 *
 * For production at scale, prefer PgBouncer too; this pool is still needed
 * to reuse connections inside each API instance.
 */
export function createPgPool(connectionString = env.databaseUrl) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const max = Number(process.env.PG_POOL_MAX || "20");
  const idleTimeoutMillis = Number(process.env.PG_POOL_IDLE_MS || "30000");
  const connectionTimeoutMillis = Number(process.env.PG_POOL_CONN_TIMEOUT_MS || "5000");

  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  });

  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[pg] pool error", err);
  });

  return pool;
}

