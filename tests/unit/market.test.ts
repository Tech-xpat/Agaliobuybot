import { describe, expect, it, vi } from 'vitest';
import { DexScreenerProvider } from '../../src/market-data/dexscreener.provider';
import type { MarketDataProvider } from '../../src/market-data/market.provider';
import { MarketService } from '../../src/market-data/market.service';
import { CacheService } from '../../src/services/cache.service';
import { ExternalServiceError } from '../../src/utils/errors';
import { marketData, OFFICIAL, OTHER, silentLog } from '../fixtures';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const pair = (over: Record<string, unknown> = {}) => ({
  chainId: 'bsc',
  dexId: 'pancakeswap',
  url: 'https://dexscreener.com/bsc/0xpair',
  pairAddress: '0xpair',
  baseToken: { address: OFFICIAL, symbol: 'AGALIO' },
  quoteToken: { address: OTHER, symbol: 'USDT' },
  priceUsd: '0.0123',
  volume: { h24: 1000 },
  priceChange: { h24: -2.5 },
  liquidity: { usd: 5000 },
  fdv: 123456,
  marketCap: 120000,
  pairCreatedAt: 1735689600000,
  ...over,
});

const provider = (fetchImpl: typeof fetch, retries = 1) =>
  new DexScreenerProvider({ baseUrl: 'https://api.dexscreener.com', timeoutMs: 1000, maxRetries: retries, fetchImpl, sleep: async () => undefined }, silentLog);

describe('DexScreener provider (mocked API)', () => {
  it('calls the BSC token-pairs endpoint and maps fields', async () => {
    const f = vi.fn().mockResolvedValue(json([pair()]));
    const d = await provider(f as unknown as typeof fetch).getTokenMarketData(OFFICIAL);
    expect(f.mock.calls[0]![0]).toBe(`https://api.dexscreener.com/token-pairs/v1/bsc/${OFFICIAL}`);
    expect(d).toMatchObject({ provider: 'DexScreener', priceUsd: 0.0123, liquidityUsd: 5000, marketCapUsd: 120000, fdvUsd: 123456, volume24hUsd: 1000, priceChange24hPct: -2.5, dexName: 'pancakeswap', pairAddress: '0xpair' });
    expect(d?.chartUrl).toBe('https://dexscreener.com/bsc/0xpair');
    expect(d?.holderCount).toBeNull();
  });

  it('returns null (missing trading pair) for an empty list and for 404', async () => {
    expect(await provider((async () => json([])) as unknown as typeof fetch).getTokenMarketData(OFFICIAL)).toBeNull();
    expect(await provider((async () => json({}, 404)) as unknown as typeof fetch).getTokenMarketData(OFFICIAL)).toBeNull();
  });

  it('ignores pairs on other chains and pairs where our token is only the quote token', async () => {
    const f = async () => json([pair({ chainId: 'ethereum' }), pair({ baseToken: { address: OTHER }, quoteToken: { address: OFFICIAL } })]);
    expect(await provider(f as unknown as typeof fetch).getTokenMarketData(OFFICIAL)).toBeNull();
  });

  it('picks the pair with the highest liquidity', async () => {
    const f = async () => json([pair({ pairAddress: '0xlow', liquidity: { usd: 10 } }), pair({ pairAddress: '0xhigh', liquidity: { usd: 99999 } })]);
    expect((await provider(f as unknown as typeof fetch).getTokenMarketData(OFFICIAL))?.pairAddress).toBe('0xhigh');
  });

  it('does not trust a chart URL on a foreign host', async () => {
    const f = async () => json([pair({ url: 'https://evil.example/x' })]);
    expect((await provider(f as unknown as typeof fetch).getTokenMarketData(OFFICIAL))?.chartUrl).toBeNull();
  });

  it('retries on 429 then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({}, 429, { 'retry-after': '1' })).mockResolvedValueOnce(json([pair()]));
    expect((await provider(f as unknown as typeof fetch).getTokenMarketData(OFFICIAL))?.priceUsd).toBe(0.0123);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('throws ExternalServiceError when the API stays down', async () => {
    const f = vi.fn().mockResolvedValue(json({}, 503));
    await expect(provider(f as unknown as typeof fetch, 2).getTokenMarketData(OFFICIAL)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('throws on network errors/timeouts and on garbage payloads', async () => {
    await expect(provider((async () => { throw new Error('ETIMEDOUT'); }) as unknown as typeof fetch).getTokenMarketData(OFFICIAL)).rejects.toBeInstanceOf(ExternalServiceError);
    await expect(provider((async () => json({ not: 'an array' })) as unknown as typeof fetch).getTokenMarketData(OFFICIAL)).rejects.toBeInstanceOf(ExternalServiceError);
  });
});

describe('MarketService', () => {
  const mk = (p: MarketDataProvider[]) => new MarketService(p, new CacheService(null, silentLog), silentLog, { refreshSeconds: 60 });
  const ok: MarketDataProvider = { name: 'A', getTokenMarketData: async () => marketData };
  const none: MarketDataProvider = { name: 'A', getTokenMarketData: async () => null };
  const down: MarketDataProvider = { name: 'A', getTokenMarketData: async () => { throw new ExternalServiceError('x', 'A'); } };

  it('reports ok / no_pair / unavailable distinctly', async () => {
    expect((await mk([ok]).get(OFFICIAL)).status).toBe('ok');
    expect((await mk([none]).get(OFFICIAL)).status).toBe('no_pair');
    const r = await mk([down]).get(OFFICIAL);
    expect(r).toMatchObject({ status: 'unavailable', data: null });
  });

  it('caches results for the refresh interval', async () => {
    const spy = vi.fn(async () => marketData);
    const svc = mk([{ name: 'A', getTokenMarketData: spy }]);
    await svc.get(OFFICIAL);
    await svc.get(OFFICIAL);
    expect(spy).toHaveBeenCalledTimes(1);
    await svc.get(OFFICIAL, { force: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns pairCreatedAt as a Date on a cache hit (cache stores JSON)', async () => {
    const svc = mk([{ name: 'A', getTokenMarketData: async () => ({ ...marketData, pairCreatedAt: new Date('2026-01-01T00:00:00Z') }) }]);
    await svc.get(OFFICIAL);
    const cached = await svc.get(OFFICIAL);
    expect(cached.data?.pairCreatedAt).toBeInstanceOf(Date);
    expect(cached.data?.pairCreatedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('serves stale data (flagged) when the provider later fails', async () => {
    let fail = false;
    const svc = mk([{ name: 'A', getTokenMarketData: async () => { if (fail) throw new ExternalServiceError('x', 'A'); return marketData; } }]);
    await svc.get(OFFICIAL);
    fail = true;
    const r = await svc.get(OFFICIAL, { force: true });
    expect(r).toMatchObject({ status: 'ok', stale: true });
  });

  it('falls through to a second provider (provider abstraction)', async () => {
    const r = await mk([down, { name: 'B', getTokenMarketData: async () => marketData }]).get(OFFICIAL);
    expect(r).toMatchObject({ status: 'ok', providerName: 'B' });
  });
});
