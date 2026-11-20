import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../../src/database/prisma';
import { createRepositories } from '../../src/database/repositories';
import { createCacheRedis, toRedisLike } from '../../src/queue/redis';
import { BackgroundJobs } from '../../src/queue/workers';
import { CacheService } from '../../src/services/cache.service';
import { OFFICIAL, OTHER, silentLog, testEnv } from '../fixtures';
import { TEST_DB, resetDb } from './harness';

describe.skipIf(!TEST_DB)('database persistence (real Postgres)', () => {
  const db = createPrisma(TEST_DB!);
  afterAll(async () => db.$disconnect());

  it('seeds once and keeps admin changes across restarts (new client, same DB)', async () => {
    await resetDb(db);
    const env = testEnv({ AGALIO_CONTRACT_ADDRESS: OFFICIAL, AGALIO_WEBSITE_URL: 'https://agalio.example' });
    const first = createRepositories(db);
    const seeded = await first.tokens.ensureSeeded(env);
    expect(seeded.contract?.checksum).toBe(OFFICIAL);
    await first.tokens.update(seeded.token.id, { websiteUrl: 'https://changed.example', launchStatus: 'TRADING_LIVE' });
    await first.config.update({ paused: true });

    const restarted = createPrisma(TEST_DB!);
    const second = createRepositories(restarted);
    const again = await second.tokens.ensureSeeded(env); // must NOT overwrite admin changes
    expect(again.token.id).toBe(seeded.token.id);
    expect(again.token.websiteUrl).toBe('https://changed.example');
    expect(again.token.launchStatus).toBe('TRADING_LIVE');
    expect((await second.config.ensure(env)).paused).toBe(true);
    await restarted.$disconnect();
  });

  it('enforces a single official contract and unique detections', async () => {
    await resetDb(db);
    const repos = createRepositories(db);
    const { token } = await repos.tokens.ensureSeeded(testEnv({ AGALIO_CONTRACT_ADDRESS: OFFICIAL }));
    await repos.tokens.setOfficialContract(token.id, { lower: OTHER.toLowerCase(), checksum: OTHER });
    expect(await db.contractAddress.count({ where: { isOfficial: true } })).toBe(1);
    expect((await repos.tokens.getOfficialContract(token.id))?.checksum).toBe(OTHER);
    await repos.tokens.setOfficialContract(token.id, { lower: OFFICIAL.toLowerCase(), checksum: OFFICIAL }); // switching back reuses the row
    expect(await db.contractAddress.count()).toBe(2);

    const group = await repos.groups.ensure(-1001234567890n, 'AGALIO NETWORK');
    const rec = { groupId: group.id, messageId: 1, userId: 7n, contract: OFFICIAL, matched: true, isForward: false };
    expect(await repos.announcements.tryRecordDetection(rec)).toBe(true);
    expect(await repos.announcements.tryRecordDetection(rec)).toBe(false);
    expect(await repos.announcements.tryRecordDetection({ ...rec, messageId: 2 })).toBe(true);
  });

  it('stores audit logs with BigInt actors and JSON details, and market snapshots', async () => {
    await resetDb(db);
    const repos = createRepositories(db);
    const { token } = await repos.tokens.ensureSeeded(testEnv());
    await repos.audit.audit(1001n, 'test.action', { id: 5n, nested: { ok: true } });
    const [row] = await repos.audit.recentAudit(1);
    expect(row?.actorId).toBe(1001n);
    expect(row?.details).toEqual({ id: '5', nested: { ok: true } });
    await repos.market.save(token.id, { provider: 'X', priceUsd: 0.5, liquidityUsd: 10, marketCapUsd: null, fdvUsd: null, volume24hUsd: null, priceChange24hPct: null, pairAddress: '0xp', dexName: 'pancake', pairCreatedAt: null, chartUrl: null, holderCount: null, fetchedAt: Date.now() });
    expect((await repos.market.latest(token.id))?.priceUsd).toBe('0.5');
  });

  it('the shipped migration SQL matches the Prisma schema (all tables usable)', async () => {
    const tables = (await db.$queryRaw<{ tablename: string }[]>`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public'`).map((t) => t.tablename);
    for (const t of ['Token', 'ContractAddress', 'BotConfiguration', 'TelegramGroup', 'Administrator', 'Announcement', 'DetectedMessage', 'ButtonConfiguration', 'MarketDataSnapshot', 'AuditLog', 'BotEvent']) {
      expect(tables).toContain(t);
    }
  });
});

const REDIS_URL = process.env.TEST_REDIS_URL;

describe.skipIf(!REDIS_URL)('Redis integration (real Redis)', () => {
  it('setNx is atomic across two cache instances (shared dedup)', async () => {
    const client = createCacheRedis(REDIS_URL!, silentLog);
    await client.connect();
    const a = new CacheService(toRedisLike(client), silentLog, `it${Date.now()}:`);
    const key = `k${Math.random()}`;
    const [x, y] = await Promise.all([a.setNx(key, 5), a.setNx(key, 5)]);
    expect([x, y].sort()).toEqual([false, true]);
    expect(a.usingFallback).toBe(false);
    client.disconnect();
  });

  it('degrades to memory when Redis is unreachable', async () => {
    const dead = createCacheRedis('redis://127.0.0.1:1', silentLog);
    await dead.connect().catch(() => undefined);
    const cache = new CacheService(toRedisLike(dead), silentLog);
    await expect(cache.set('x', 'y', 5)).resolves.toBeUndefined();
    expect(await cache.get('x')).toBe('y');
    expect(await cache.setNx('lock', 5)).toBe(true);
    dead.disconnect();
  });

  it('BullMQ: a queued announcement retry is processed by the worker', async () => {
    const received: unknown[] = [];
    const jobs = new BackgroundJobs(
      { redisUrl: REDIS_URL!, refreshSeconds: 3600, prefix: `test-${Date.now()}` },
      { refreshMarket: async () => undefined, checkRpc: async () => undefined, prune: async () => undefined, retryAnnouncement: async (d) => void received.push(d) },
      silentLog,
    );
    await jobs.start();
    expect(jobs.running).toBe('bullmq');
    expect(await jobs.enqueueAnnounceRetry({ chatId: '-100', replyTo: 5, kind: 'AUTO' }, 0)).toBe(true);
    for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([{ chatId: '-100', replyTo: 5, kind: 'AUTO' }]);
    await jobs.stop();
  });

  it('background jobs fall back to timers when Redis is down', async () => {
    const jobs = new BackgroundJobs({ redisUrl: 'redis://127.0.0.1:1', refreshSeconds: 3600 }, { refreshMarket: async () => undefined, checkRpc: async () => undefined, prune: async () => undefined, retryAnnouncement: async () => undefined }, silentLog);
    await jobs.start();
    expect(jobs.running).toBe('timers');
    await jobs.stop();
  });
});

