import { createRedisClient } from "../redis/client.js";
import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool(env.databaseUrl);

let redis = null;
function getRedis() {
  if (redis) return redis;
  if (process.env.REDIS_URL || process.env.REDIS_MODE === "cluster") {
    redis = createRedisClient();
  }
  return redis;
}

/**
 * Invalidate menu cache for a restaurant
 * Can be called from anywhere that modifies menu data
 */
export async function invalidateMenuCache(restaurantId) {
  const redisClient = getRedis();
  if (!redisClient) {
    console.log('[Cache] Redis not configured, skipping cache invalidation');
    return;
  }

  try {
    const restaurant = await pool.query(
      'SELECT slug FROM restaurants WHERE id = $1', 
      [restaurantId]
    );
    
    if (!restaurant.rows[0]) {
      console.warn(`[Cache] Restaurant ${restaurantId} not found`);
      return;
    }

    const slug = restaurant.rows[0].slug;
    
    // Delete all dietary filter variants
    const cacheKeys = [
      `menu:${slug}:all`,     // Default/no filter
      `menu:${slug}:veg`,     // Veg filter
      `menu:${slug}:non-veg`, // Non-veg filter
    ];
    
    // Delete all keys in parallel
    const deletePromises = cacheKeys.map(key => 
      redisClient.del(key)
        .then(() => console.log(`[Cache] ✓ Deleted ${key}`))
        .catch(err => console.error(`[Cache] ✗ Failed to delete ${key}:`, err))
    );
    
    await Promise.all(deletePromises);
    
    console.log(`[Cache] Invalidated ${cacheKeys.length} cache keys for restaurant ${restaurantId} (slug: ${slug})`);
  } catch (err) {
    console.error('[Cache] Cache invalidation error:', err);
  }
}