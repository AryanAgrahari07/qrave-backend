/**
 * Minimal caching helpers.
 * Use for read-heavy endpoints like public menu: /r/:slug
 */

export async function cacheGetJson(redis, key) {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function cacheSetJson(redis, key, value, ttlSeconds) {
  const payload = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.set(key, payload, "EX", ttlSeconds);
    return;
  }
  await redis.set(key, payload);
}

export async function cacheGetOrSetJson(redis, key, ttlSeconds, producer) {
  const cached = await cacheGetJson(redis, key);
  if (cached !== null) return cached;
  const fresh = await producer();
  await cacheSetJson(redis, key, fresh, ttlSeconds);
  return fresh;
}

