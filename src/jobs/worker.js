// import { dequeueJob, completeJob, failJob, getQueueStats } from './redis-jobs.js';
// import { processExtractionJob } from './processor.js';

// let isRunning = true;

// /**
//  * Worker loop - processes jobs from queue
//  */
// async function startWorker() {
//   console.log('[Worker] Starting menu extraction worker...');
//   console.log('[Worker] Press Ctrl+C to stop');

//   // Log stats every 30 seconds
//   const statsInterval = setInterval(async () => {
//     const stats = await getQueueStats();
//     console.log(`[Worker] Queue stats: ${stats.pending} pending, ${stats.processing} processing, ${stats.failed} failed`);
//   }, 30000);

//   while (isRunning) {
//     try {
//       const job = await dequeueJob();
      
//       if (!job) {
//         // No jobs, wait 2 seconds
//         await new Promise(resolve => setTimeout(resolve, 2000));
//         continue;
//       }

//       console.log(`[Worker] Processing job ${job.id}`);

//       try {
//         await processExtractionJob(job.data);
//         await completeJob(job.id);
//       } catch (error) {
//         console.error(`[Worker] Job ${job.id} failed:`, error.message);
//         await failJob(job.id, error.message);
//       }

//     } catch (error) {
//       console.error('[Worker] Fatal error:', error);
//       await new Promise(resolve => setTimeout(resolve, 5000));
//     }
//   }

//   clearInterval(statsInterval);
//   console.log('[Worker] Stopped');
// }

// // Graceful shutdown
// process.on('SIGTERM', () => {
//   console.log('[Worker] Received SIGTERM, shutting down...');
//   isRunning = false;
// });

// process.on('SIGINT', () => {
//   console.log('[Worker] Received SIGINT, shutting down...');
//   isRunning = false;
// });

// // Start if this is the main module
// if (import.meta.url === `file://${process.argv[1]}`) {
//   startWorker().catch(err => {
//     console.error('[Worker] Fatal error:', err);
//     process.exit(1);
//   });
// }

// export { startWorker };





import { dequeueJob, completeJob, failJob, getQueueStats } from './redis-jobs.js';
import { processExtractionJob } from './processor.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Get current file path (works on Windows)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isRunning = true;

/**
 * Worker loop - processes jobs from queue
 */
async function startWorker() {
  console.log('[Worker] Starting menu extraction worker...');
  console.log('[Worker] Current directory:', process.cwd());
  console.log('[Worker] Worker file:', __filename);
  console.log('[Worker] Press Ctrl+C to stop');
  console.log('');

  // Log stats every 30 seconds
  const statsInterval = setInterval(async () => {
    try {
      const stats = await getQueueStats();
      console.log(`[Worker] Queue stats: ${stats.pending} pending, ${stats.processing} processing, ${stats.failed} failed`);
    } catch (error) {
      console.error('[Worker] Error getting stats:', error.message);
    }
  }, 30000);

  console.log('[Worker] Waiting for jobs...');

  while (isRunning) {
    try {
      const job = await dequeueJob();
      
      if (!job) {
        // No jobs, wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      console.log(`[Worker] Processing job ${job.id}`);

      try {
        await processExtractionJob(job.data);
        await completeJob(job.id);
        console.log(`[Worker] ✓ Job ${job.id} completed successfully`);
      } catch (error) {
        console.error(`[Worker] ✗ Job ${job.id} failed:`, error.message);
        console.error(error.stack);
        await failJob(job.id, error.message);
      }

    } catch (error) {
      console.error('[Worker] Fatal error:', error);
      console.error(error.stack);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  clearInterval(statsInterval);
  console.log('[Worker] Stopped');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM, shutting down...');
  isRunning = false;
});

process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT, shutting down...');
  isRunning = false;
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Worker] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the worker immediately
console.log('[Worker] Initializing...');
startWorker().catch(err => {
  console.error('[Worker] Fatal startup error:', err);
  console.error(err.stack);
  process.exit(1);
});

export { startWorker };