// Simple in-memory cache for analytics responses.
// This avoids re-running expensive aggregation queries on every dashboard poll.
//
// NOTE: This is per-node-instance cache. In multi-instance deployments, consider Redis.

const store = new Map();

/**
 * @param {string} key
 */
export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs
 */
export function setCached(key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearCache(prefix) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
