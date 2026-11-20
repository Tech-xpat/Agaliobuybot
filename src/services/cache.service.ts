import type { Logger } from 'pino';

/** The small subset of ioredis used here, so it can be faked in tests. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
}

interface MemEntry {
  value: string;
  expiresAt: number;
}

/**
 * Redis-backed cache with an in-memory fallback. If Redis is down the bot keeps
 * working (single-process semantics) and logs the failure instead of crashing.
 */
export class CacheService {
  private mem = new Map<string, MemEntry>();
  private redisHealthy = true;
  private lastWarn = 0;

  constructor(
    private readonly redis: RedisLike | null,
    private readonly log: Logger,
    private readonly prefix = 'agalio:',
  ) {}

  get usingFallback(): boolean {
    return !this.redis || !this.redisHealthy;
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  private fail(op: string, err: unknown): void {
    this.redisHealthy = false;
    const now = Date.now();
    if (now - this.lastWarn > 30_000) {
      this.lastWarn = now;
      this.log.warn({ err, op }, 'Redis unavailable, using in-memory fallback');
    }
  }

  private sweep(): void {
    if (this.mem.size < 5000) return;
    const now = Date.now();
    for (const [k, v] of this.mem) if (v.expiresAt <= now) this.mem.delete(k);
  }

  private memGet(key: string): string | null {
    const e = this.mem.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return e.value;
  }

  private memSet(key: string, value: string, ttlSeconds: number): void {
    this.sweep();
    this.mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get(key: string): Promise<string | null> {
    if (this.redis) {
      try {
        const v = await this.redis.get(this.k(key));
        this.redisHealthy = true;
        return v;
      } catch (err) {
        this.fail('get', err);
      }
    }
    return this.memGet(this.k(key));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(this.k(key), value, 'EX', ttlSeconds);
        this.redisHealthy = true;
        return;
      } catch (err) {
        this.fail('set', err);
      }
    }
    this.memSet(this.k(key), value, ttlSeconds);
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  /** Atomic "set if not exists". Returns true if this caller acquired the key. */
  async setNx(key: string, ttlSeconds: number, value = '1'): Promise<boolean> {
    if (this.redis) {
      try {
        const res = await this.redis.set(this.k(key), value, 'EX', ttlSeconds, 'NX');
        this.redisHealthy = true;
        return res === 'OK';
      } catch (err) {
        this.fail('setNx', err);
      }
    }
    const full = this.k(key);
    if (this.memGet(full) !== null) return false;
    this.memSet(full, value, ttlSeconds);
    return true;
  }

  async del(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(this.k(key));
      } catch (err) {
        this.fail('del', err);
      }
    }
    this.mem.delete(this.k(key));
  }

  /** Fixed-window counter. Returns the count after increment. */
  async incrWindow(key: string, windowSeconds: number): Promise<number> {
    if (this.redis) {
      try {
        const full = this.k(key);
        const n = await this.redis.incr(full);
        if (n === 1) await this.redis.expire(full, windowSeconds);
        this.redisHealthy = true;
        return n;
      } catch (err) {
        this.fail('incr', err);
      }
    }
    const full = this.k(key);
    const cur = this.memGet(full);
    const n = (cur ? Number(cur) : 0) + 1;
    const existing = this.mem.get(full);
    this.mem.set(full, { value: String(n), expiresAt: existing?.expiresAt ?? Date.now() + windowSeconds * 1000 });
    return n;
  }

  async ping(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      await this.redis.ping();
      this.redisHealthy = true;
      return true;
    } catch (err) {
      this.fail('ping', err);
      return false;
    }
  }
}
