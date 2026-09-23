import Redis from 'ioredis';
import { config } from '../config/env';

export function createRedisClient(): Redis {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableOfflineQueue: false, // Fail immediately if offline
    lazyConnect: true,
  });

  return client;
}
