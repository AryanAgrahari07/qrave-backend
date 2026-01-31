// Diagnostic script to test Redis connection and queue
// Run with: node src/jobs/test-redis.js

import { getRedisClient } from './redis-jobs.js';

console.log('🔍 Redis Connection Diagnostic');
console.log('================================\n');

async function testRedis() {
  try {
    console.log('1️⃣ Testing Redis connection...');
    const client = await getRedisClient();
    console.log('   ✅ Connected to Redis\n');

    console.log('2️⃣ Testing basic Redis operations...');
    await client.set('test:key', 'test:value');
    const value = await client.get('test:key');
    console.log('   ✅ Set/Get works:', value);
    await client.del('test:key');
    console.log('   ✅ Delete works\n');

    console.log('3️⃣ Checking queue status...');
    const pending = await client.llen('jobs:menu-extraction');
    const processing = await client.hlen('jobs:menu-extraction:processing');
    const failed = await client.hlen('jobs:menu-extraction:failed');
    
    console.log('   Queue stats:');
    console.log('   - Pending:', pending);
    console.log('   - Processing:', processing);
    console.log('   - Failed:', failed);
    console.log('');

    if (pending > 0) {
      console.log('4️⃣ Peeking at pending jobs...');
      const jobs = await client.lrange('jobs:menu-extraction', 0, 4);
      console.log(`   Found ${jobs.length} job(s):`);
      jobs.forEach((jobStr, i) => {
        const job = JSON.parse(jobStr);
        console.log(`   ${i + 1}. Job ID: ${job.id}`);
        console.log(`      Created: ${job.createdAt}`);
        console.log(`      Attempts: ${job.attempts}`);
        if (job.data?.jobId) {
          console.log(`      Extraction Job ID: ${job.data.jobId}`);
        }
      });
      console.log('');
    }

    console.log('✅ All tests passed!');
    console.log('\n💡 Next steps:');
    console.log('   - Start the worker: npm run worker');
    console.log('   - Worker should pick up the pending jobs');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nFull error:');
    console.error(error);
    
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Check Redis is running: redis-cli ping');
    console.log('   2. Check REDIS_URL in .env');
    console.log('   3. Try: redis-server (to start Redis)');
    
    process.exit(1);
  }
}

testRedis();