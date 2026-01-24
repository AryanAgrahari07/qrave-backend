import Redis from "ioredis";

function parseRedisNodes(nodesString) {
  if (!nodesString) return [];
  return nodesString
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hostPort) => {
      const [host, portStr] = hostPort.split(":");
      const port = Number(portStr || "6379");
      return { host, port };
    });
}

/**
 * Cluster-ready Redis client.
 *
 * Env options:
 * - REDIS_MODE=single|cluster (default: single)
 * - REDIS_URL=redis://:pass@host:6379/0 (single mode)
 * - REDIS_NODES=host1:6379,host2:6379,host3:6379 (cluster mode)
 * - REDIS_PASSWORD=... (optional, for cluster)
 * - REDIS_TLS=true (optional)
 */
export function createRedisClient() {
  const mode = (process.env.REDIS_MODE || "single").toLowerCase();
  const useTls = String(process.env.REDIS_TLS || "").toLowerCase() === "true";

  if (mode === "cluster") {
    const nodes = parseRedisNodes(process.env.REDIS_NODES);
    if (nodes.length === 0) {
      throw new Error("REDIS_MODE=cluster requires REDIS_NODES");
    }

    const password = process.env.REDIS_PASSWORD;

    const cluster = new Redis.Cluster(nodes, {
      redisOptions: {
        ...(password ? { password } : {}),
        ...(useTls ? { tls: {} } : {}),
      },
    });

    cluster.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("[redis] cluster error", err);
    });

    return cluster;
  }

  const url = process.env.REDIS_URL || "redis://localhost:6379/0";
  const client = new Redis(url, {
    ...(useTls ? { tls: {} } : {}),
    // ioredis defaults are fine for now; tune later for prod.
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });

  client.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[redis] error", err);
  });

  return client;
}

