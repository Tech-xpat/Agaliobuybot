import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RedisLike } from '../services/cache.service';

/**
 * Redis client for caching, dedup and rate limiting. Fails fast when Redis is down
 * (no offline queue) so CacheService can fall back to memory instead of hanging.
 */
export function createCacheRedis(url: string, log: Logger): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  let lastLog = 0;
  client.on('error', (err) => {
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      log.warn({ err: err.message }, 'Redis connection error');
    }
  });
  client.on('ready', () => log.info('Redis connected'));
  return client;
}

/** BullMQ requires maxRetriesPerRequest = null on its connections. */
export function createQueueRedis(url: string, log: Logger): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: null, retryStrategy: (n) => Math.min(n * 500, 10_000) });
  client.on('error', (err) => log.debug({ err: err.message }, 'Queue redis error'));
  return client;
}

/** Adapts ioredis to the minimal interface CacheService needs. */
export function toRedisLike(client: Redis): RedisLike {
  return {
    get: (k) => client.get(k),
    set: (k, v, ...args) => (client.set as (...a: unknown[]) => Promise<unknown>)(k, v, ...args),
    del: (...keys) => client.del(...keys),
    incr: (k) => client.incr(k),
    expire: (k, s) => client.expire(k, s),
    ping: () => client.ping(),
  };
}
