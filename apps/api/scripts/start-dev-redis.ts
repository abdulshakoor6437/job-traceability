import { RedisMemoryServer } from 'redis-memory-server';

async function startDevRedis() {
  console.log('🚀 Starting local Redis server on port 6379...');
  const redisServer = new RedisMemoryServer({
    instance: {
      port: 6379,
    },
  });

  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  console.log(`✅ Local dev Redis server is actively running at ${host}:${port}`);
}

startDevRedis().catch((err) => {
  console.error('Failed to start dev Redis server:', err);
  process.exit(1);
});
