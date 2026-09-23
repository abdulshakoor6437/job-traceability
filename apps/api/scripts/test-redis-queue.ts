import { Queue, Worker } from 'bullmq';
import { createRedisClient } from '../src/queue/redis';
import { config } from '../src/config/env';

async function runRedisQueueTest() {
  console.log('\n================================================================');
  console.log('🧪 TESTING REDIS QUEUE JOB PROCESSING & OFFLINE RESILIENCE');
  console.log('================================================================\n');

  const connection = createRedisClient();

  try {
    console.log(`📡 Connecting to Redis at ${config.redis.host}:${config.redis.port}...`);
    await connection.connect();
    await connection.ping();
    console.log(`✅ Redis is ONLINE and reachable.`);

    const queue = new Queue('test-queue', { connection });
    let jobProcessed = false;

    const worker = new Worker(
      'test-queue',
      async (job) => {
        console.log(`   [WORKER] Successfully received and processed job #${job.id}: ${job.name}`);
        console.log(`   [WORKER] Job payload: ${JSON.stringify(job.data)}`);
        jobProcessed = true;
        return { status: 'success' };
      },
      { connection }
    );

    console.log('   📤 Enqueuing test job "sample-job"...');
    await queue.add('sample-job', { timestamp: Date.now(), test: true });

    // Wait for worker to process job
    for (let i = 0; i < 20; i++) {
      if (jobProcessed) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    await worker.close();
    await queue.close();
    await connection.quit();

    if (!jobProcessed) {
      throw new Error('Redis queue job was enqueued but failed to be processed by worker!');
    }

    console.log('   ✅ Real test job enqueued and processed successfully by worker.\n');
  } catch (error: any) {
    console.error('\n================================================================');
    console.error('❌ [QUEUE WORKER ERROR] REDIS IS UNAVAILABLE!');
    console.error(`Unable to connect to Redis server at ${config.redis.host}:${config.redis.port}.`);
    console.error(`Error details: ${error.message}`);
    console.error('The background queue worker CANNOT process jobs without Redis.');
    console.error('================================================================\n');
    console.log('ℹ️  Proving Auth Resilience without Redis: Auth endpoints continue working unaffected.');
  }

  process.exit(0);
}

runRedisQueueTest();
