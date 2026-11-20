import { describe, expect, it, vi } from 'vitest';
import { processMessage, type Decision, type IncomingMessage, type ProcessorDeps } from '../../src/detection/message-processor';
import { CacheService, type RedisLike } from '../../src/services/cache.service';
import { GROUP_ID, OFFICIAL, OTHER, silentLog } from '../fixtures';

function makeDeps(over: Partial<ProcessorDeps> = {}, cache = new CacheService(null, silentLog)) {
  const seen = new Set<string>();
  const deps: ProcessorDeps = {
    configuredChatId: BigInt(GROUP_ID),
    cache,
    log: silentLog,
    getSettings: async () => ({ enabled: true, paused: false, cooldownSeconds: 60 }),
    getOfficial: async () => ({ tokenId: 't1', contractLower: OFFICIAL.toLowerCase() }),
    ensureGroup: async () => ({ id: 'g1' }),
    recordDetection: async (i) => {
      const k = `${i.groupId}:${i.messageId}:${i.contract}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    },
    ...over,
  };
  return deps;
}

const reasonOf = (d: Decision) => (d.action === 'ignore' ? d.reason : 'announced');

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  chatId: BigInt(GROUP_ID),
  messageId: 1,
  userId: 2002n,
  text: `CA ${OFFICIAL}`,
  isForward: false,
  fromBot: false,
  ...over,
});

describe('message processor', () => {
  it('announces when the official contract appears', async () => {
    const d = await processMessage(msg(), makeDeps());
    expect(d).toMatchObject({ action: 'announce', contract: OFFICIAL });
  });

  it('announces for contracts inside ordinary text and for forwarded messages', async () => {
    const deps = makeDeps({}, new CacheService(null, silentLog));
    expect((await processMessage(msg({ messageId: 5, text: `gm 🚀 AGALIO ${OFFICIAL} wen moon` }), deps)).action).toBe('announce');
    const deps2 = makeDeps({}, new CacheService(null, silentLog));
    expect((await processMessage(msg({ messageId: 6, isForward: true }), deps2)).action).toBe('announce');
  });

  it('ignores a random other contract', async () => {
    const d = await processMessage(msg({ text: `buy ${OTHER}` }), makeDeps());
    expect(d).toEqual({ action: 'ignore', reason: 'no-official-match' });
  });

  it('ignores messages from other chats, bots, empty text', async () => {
    const deps = makeDeps();
    expect((await processMessage(msg({ chatId: -999n }), deps)).action).toBe('ignore');
    expect((await processMessage(msg({ fromBot: true }), deps)).action).toBe('ignore');
    expect((await processMessage(msg({ text: '' }), deps)).action).toBe('ignore');
  });

  it('ignores everything when paused, disabled, or no official contract is configured', async () => {
    const paused = makeDeps({ getSettings: async () => ({ enabled: true, paused: true, cooldownSeconds: 0 }) });
    const disabled = makeDeps({ getSettings: async () => ({ enabled: false, paused: false, cooldownSeconds: 0 }) });
    const noContract = makeDeps({ getOfficial: async () => null });
    expect(reasonOf(await processMessage(msg(), paused))).toBe('paused');
    expect(reasonOf(await processMessage(msg(), disabled))).toBe('announcements-disabled');
    expect(reasonOf(await processMessage(msg(), noContract))).toBe('no-official-contract');
  });

  it('prevents duplicate announcements for the same message (cache path)', async () => {
    const deps = makeDeps({}, new CacheService(null, silentLog));
    expect((await processMessage(msg({ messageId: 9 }), deps)).action).toBe('announce');
    expect(await processMessage(msg({ messageId: 9 }), deps)).toEqual({ action: 'ignore', reason: 'duplicate' });
  });

  it('prevents duplicates even if the cache was lost (durable DB path)', async () => {
    const shared = makeDeps({}, new CacheService(null, silentLog));
    await processMessage(msg({ messageId: 9 }), shared);
    // simulate restart: fresh cache, same durable store
    const afterRestart = { ...shared, cache: new CacheService(null, silentLog) };
    expect(await processMessage(msg({ messageId: 9 }), afterRestart)).toEqual({ action: 'ignore', reason: 'duplicate' });
  });

  it('enforces the cooldown between different messages, and only that', async () => {
    const deps = makeDeps({}, new CacheService(null, silentLog));
    expect((await processMessage(msg({ messageId: 1 }), deps)).action).toBe('announce');
    expect(await processMessage(msg({ messageId: 2 }), deps)).toEqual({ action: 'ignore', reason: 'cooldown' });
  });

  it('cooldown of 0 allows every distinct message', async () => {
    const deps = makeDeps({ getSettings: async () => ({ enabled: true, paused: false, cooldownSeconds: 0 }) }, new CacheService(null, silentLog));
    expect((await processMessage(msg({ messageId: 1 }), deps)).action).toBe('announce');
    expect((await processMessage(msg({ messageId: 2 }), deps)).action).toBe('announce');
  });
});

describe('Redis failure handling', () => {
  const brokenRedis = (): RedisLike => ({
    get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    del: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    expire: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  });

  it('falls back to memory instead of throwing', async () => {
    const cache = new CacheService(brokenRedis(), silentLog);
    await expect(cache.set('a', '1', 10)).resolves.toBeUndefined();
    expect(await cache.get('a')).toBe('1');
    expect(await cache.setNx('lock', 10)).toBe(true);
    expect(await cache.setNx('lock', 10)).toBe(false);
    expect(await cache.incrWindow('n', 60)).toBe(1);
    expect(await cache.incrWindow('n', 60)).toBe(2);
    expect(await cache.ping()).toBe(false);
    expect(cache.usingFallback).toBe(true);
  });

  it('keeps announcing and de-duplicating while Redis is down', async () => {
    const deps = makeDeps({}, new CacheService(brokenRedis(), silentLog));
    expect((await processMessage(msg({ messageId: 3 }), deps)).action).toBe('announce');
    expect(reasonOf(await processMessage(msg({ messageId: 3 }), deps))).toBe('duplicate');
  });
});
