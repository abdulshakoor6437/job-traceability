import Redis from 'ioredis';
import { config } from '../config/env';

export function createRedisClient(): Redis {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableOfflineQueue: true, // Allow commands to queue while connecting
  });

  client.on('error', (err) => {
    // Catch connection errors gracefully so ioredis does not emit uncaught exception events
  });

  return client;
}
