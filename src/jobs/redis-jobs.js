import { createRedisClient } from '../redis/client.js';
import crypto from 'crypto';

let redis = null;
let initPromise = null;

/**
 * Get Redis client singleton
 * ioredis connects automatically, so we don't call .connect()
 */
export async function getRedisClient() {
  // Return existing connection
  if (redis) {
    return redis;
  }

  // Wait if initialization is in progress
  if (initPromise) {
    return initPromise;
  }

  // Initialize new connection
  initPromise = (async () => {
    try {
      redis = createRedisClient();
      
      redis.on('error', (err) => {
        console.error('[Redis] Connection error:', err);
      });
      
      redis.on('end', () => {
        console.log('[Redis] Connection closed');
        redis = null;
        initPromise = null;
      });
      
      redis.on('connect', () => {
        console.log('[Redis] Connected successfully');
      });
      
      // Wait for ready event to ensure connection is established
      await new Promise((resolve, reject) => {
        redis.once('ready', () => {
          console.log('[Redis] Client ready');
          resolve();
        });
        redis.once('error', (err) => {
          console.error('[Redis] Initial connection failed:', err);
          reject(err);
        });
      });
      
      return redis;
    } catch (error) {
      console.error('[Redis] Failed to initialize:', error);
      redis = null;
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

const QUEUE_KEY = 'jobs:menu-extraction';
const PROCESSING_KEY = 'jobs:menu-extraction:processing';
const FAILED_KEY = 'jobs:menu-extraction:failed';

/**
 * Add a job to the queue
 */
export async function enqueueJob(data) {
  try {
    const client = await getRedisClient();
    
    const job = {
      id: crypto.randomUUID(),
      type: 'menu-extraction',
      data,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };

    // ioredis uses lowercase method names: rpush, not rPush
    await client.rpush(QUEUE_KEY, JSON.stringify(job));
    console.log(`[Jobs] ✓ Enqueued job ${job.id} for extraction job ${data.jobId}`);
    
    return job.id;
  } catch (error) {
    console.error('[Jobs] ✗ Failed to enqueue job:', error);
    throw error;
  }
}

/**
 * Get next job from queue
 */
export async function dequeueJob() {
  try {
    const client = await getRedisClient();
    
    // ioredis uses lowercase: lpop, not lPop
    const jobStr = await client.lpop(QUEUE_KEY);
    if (!jobStr) return null;

    const job = JSON.parse(jobStr);
    
    // ioredis uses lowercase: hset, not hSet
    await client.hset(PROCESSING_KEY, job.id, JSON.stringify(job));
    
    console.log(`[Jobs] → Processing job ${job.id}`);
    return job;
  } catch (error) {
    console.error('[Jobs] ✗ Failed to dequeue job:', error);
    throw error;
  }
}

/**
 * Mark job as completed
 */
export async function completeJob(jobId) {
  try {
    const client = await getRedisClient();
    // ioredis uses lowercase: hdel, not hDel
    await client.hdel(PROCESSING_KEY, jobId);
    console.log(`[Jobs] ✓ Completed job ${jobId}`);
  } catch (error) {
    console.error('[Jobs] ✗ Failed to complete job:', error);
    throw error;
  }
}

/**
 * Mark job as failed (retry or move to failed)
 */
export async function failJob(jobId, error) {
  try {
    const client = await getRedisClient();
    
    // ioredis uses lowercase: hget, not hGet
    const jobStr = await client.hget(PROCESSING_KEY, jobId);
    if (!jobStr) {
      console.warn(`[Jobs] Job ${jobId} not found in processing set`);
      return;
    }

    const job = JSON.parse(jobStr);
    job.attempts += 1;
    job.lastError = error;

    const maxRetries = parseInt(process.env.EXTRACTION_MAX_RETRIES || '3');

    if (job.attempts < maxRetries) {
      // Retry: move back to queue
      console.log(`[Jobs] ↻ Retrying job ${jobId} (attempt ${job.attempts}/${maxRetries})`);
      await client.rpush(QUEUE_KEY, JSON.stringify(job));
    } else {
      // Max retries: mark as failed
      console.log(`[Jobs] ✗ Failed job ${jobId} after ${job.attempts} attempts`);
      await client.hset(FAILED_KEY, jobId, JSON.stringify({ ...job, error }));
    }

    await client.hdel(PROCESSING_KEY, jobId);
  } catch (error) {
    console.error('[Jobs] ✗ Failed to mark job as failed:', error);
    throw error;
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  try {
    const client = await getRedisClient();
    
    // ioredis uses lowercase: llen, hlen
    const pending = await client.llen(QUEUE_KEY);
    const processing = await client.hlen(PROCESSING_KEY);
    const failed = await client.hlen(FAILED_KEY);

    return { pending, processing, failed };
  } catch (error) {
    console.error('[Jobs] ✗ Failed to get queue stats:', error);
    return { pending: 0, processing: 0, failed: 0 };
  }
}

/**
 * Clear all queues (useful for debugging)
 */
export async function clearAllQueues() {
  try {
    const client = await getRedisClient();
    await client.del(QUEUE_KEY);
    await client.del(PROCESSING_KEY);
    await client.del(FAILED_KEY);
    console.log('[Jobs] ✓ Cleared all queues');
  } catch (error) {
    console.error('[Jobs] ✗ Failed to clear queues:', error);
    throw error;
  }
}

// Graceful shutdown
const shutdown = async () => {
  console.log('[Redis] Shutting down gracefully...');
  if (redis) {
    try {
      await redis.quit();
      console.log('[Redis] Connection closed');
    } catch (err) {
      console.error('[Redis] Error during shutdown:', err);
      process.exit(1);
    }
  }
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);