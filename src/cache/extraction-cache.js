import { getRedisClient } from '../jobs/redis-jobs.js';

const CACHE_TTL = 86400; // 24 hours

/**
 * Cache job result
 */
export async function cacheJobResult(jobId, data) {
  const client = await getRedisClient();
  await client.setEx(
    `extraction:job:${jobId}`,
    CACHE_TTL,
    JSON.stringify(data)
  );
}

/**
 * Get cached job result
 */
export async function getCachedJob(jobId) {
  const client = await getRedisClient();
  const cached = await client.get(`extraction:job:${jobId}`);
  return cached ? JSON.parse(cached) : null;
}

/**
 * Cache by image hash for duplicate detection
 */
export async function cacheImageHash(hash, extractedData) {
  const client = await getRedisClient();
  await client.setEx(
    `extraction:hash:${hash}`,
    2592000, // 30 days
    JSON.stringify(extractedData)
  );
}

/**
 * Get cached extraction by image hash
 */
export async function getCachedByHash(hash) {
  const client = await getRedisClient();
  const cached = await client.get(`extraction:hash:${hash}`);
  return cached ? JSON.parse(cached) : null;
}

/**
 * Increment daily extraction count
 */
export async function incrementExtractionCount(restaurantId) {
  const client = await getRedisClient();
  const date = new Date().toISOString().split('T')[0];
  const key = `extraction:stats:${restaurantId}:${date}`;
  
  await client.incr(key);
  await client.expire(key, 2592000); // 30 days
}

/**
 * Get extraction stats for restaurant
 */
export async function getExtractionStats(restaurantId, days = 30) {
  const client = await getRedisClient();
  const stats = {};
  
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const key = `extraction:stats:${restaurantId}:${dateStr}`;
    
    const count = await client.get(key);
    stats[dateStr] = parseInt(count) || 0;
  }
  
  return stats;
}