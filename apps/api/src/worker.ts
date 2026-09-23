import { Worker } from 'bullmq';
import { createRedisClient } from './queue/redis';
import { config } from './config/env';

console.log('🚀 Starting Background Job Worker...');

async function startWorker() {
  const connection = createRedisClient();

  try {
    // Attempt ping to check Redis availability
    await connection.connect();
    await connection.ping();
    console.log(`✅ Redis connected successfully at ${config.redis.host}:${config.redis.port}`);
  } catch (error: any) {
    console.error('\n================================================================');
    console.error('❌ [QUEUE WORKER ERROR] REDIS IS UNAVAILABLE!');
    console.error(`Unable to connect to Redis server at ${config.redis.host}:${config.redis.port}.`);
    console.error(`Error details: ${error.message}`);
    console.error('The background queue worker CANNOT process jobs without Redis.');
    console.error('================================================================\n');
    process.exit(1);
  }

  // Create BullMQ Worker
  const worker = new Worker(
    'job-queue',
    async (job) => {
      console.log(`[JOB WORKER] Processing job ${job.id} - ${job.name}`);
      return { status: 'completed' };
    },
    { connection }
  );

  worker.on('completed', (job) => {
    console.log(`[JOB WORKER] Job ${job.id} completed.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[JOB WORKER] Job ${job?.id} failed with error: ${err.message}`);
  });

  console.log('👷 Job Queue Worker is actively running and waiting for jobs.');
}

startWorker();
