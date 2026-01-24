import { createRedisClient } from "../redis/client.js";

let redisClient = null;

function getRedis() {
  if (redisClient) return redisClient;
  if (process.env.REDIS_URL || process.env.REDIS_MODE === "cluster") {
    redisClient = createRedisClient();
  }
  return redisClient;
}

const memoryStore = new Map();

/**
 * Simple fixed-window rate limiter.
 * Uses Redis if available, otherwise per-process in-memory store.
 */
export function rateLimit({ keyPrefix, windowSeconds, max }) {
  return async function rateLimitMiddleware(req, res, next) {
    const keyBase = `${keyPrefix}:${req.ip || "unknown"}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    const redis = getRedis();
    try {
      if (redis) {
        const key = keyBase;
        const current = await redis.incr(key);
        if (current === 1) {
          await redis.pexpire(key, windowMs);
        }
        if (current > max) {
          res.setHeader("Retry-After", Math.ceil(windowSeconds));
          return res.status(429).json({ message: "Too many requests" });
        }
        return next();
      }
    } catch {
      // fall through to memory store on Redis errors
    }

    const entry = memoryStore.get(keyBase);
    if (!entry || now - entry.start >= windowMs) {
      memoryStore.set(keyBase, { start: now, count: 1 });
      return next();
    }

    if (entry.count >= max) {
      res.setHeader("Retry-After", Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ message: "Too many requests" });
    }

    entry.count += 1;
    memoryStore.set(keyBase, entry);
    return next();
  };
}

