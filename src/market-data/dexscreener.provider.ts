import { z } from 'zod';
import type { Logger } from 'pino';
import { DEXSCREENER_CHAIN_ID } from '../config/constants';
import { ExternalServiceError, errMessage } from '../utils/errors';
import type { MarketData, MarketDataProvider } from './market.provider';

const num = z.preprocess((v) => (v === null || v === undefined || v === '' ? undefined : Number(v)), z.number().finite().optional());

const pairSchema = z.object({
  chainId: z.string(),
  dexId: z.string().optional(),
  url: z.string().optional(),
  pairAddress: z.string().optional(),
  baseToken: z.object({ address: z.string() }).passthrough(),
  quoteToken: z.object({ address: z.string() }).passthrough().optional(),
  priceUsd: num,
  volume: z.object({ h24: num }).passthrough().optional(),
  priceChange: z.object({ h24: num }).passthrough().optional(),
  liquidity: z.object({ usd: num }).passthrough().optional(),
  fdv: num,
  marketCap: num,
  pairCreatedAt: num,
});
const responseSchema = z.array(z.unknown());

export interface DexScreenerOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * DexScreener token-pairs API: GET /token-pairs/v1/{chainId}/{tokenAddress}
 * Docs: https://docs.dexscreener.com/api/reference
 */
export class DexScreenerProvider implements MarketDataProvider {
  readonly name = 'DexScreener';
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly opts: DexScreenerOptions,
    private readonly log: Logger,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async getTokenMarketData(address: string): Promise<MarketData | null> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/token-pairs/v1/${DEXSCREENER_CHAIN_ID}/${address}`;
    const body = await this.requestJson(url);
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new ExternalServiceError('DexScreener returned an unexpected payload', this.name, false);

    const target = address.toLowerCase();
    const pairs = parsed.data
      .map((p) => pairSchema.safeParse(p))
      .flatMap((r) => (r.success ? [r.data] : []))
      // Only BSC pairs where our token is the BASE token, so priceUsd refers to our token.
      .filter((p) => p.chainId === DEXSCREENER_CHAIN_ID && p.baseToken.address.toLowerCase() === target);

    if (pairs.length === 0) return null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = pairs[0]!;

    return {
      provider: this.name,
      priceUsd: best.priceUsd ?? null,
      liquidityUsd: best.liquidity?.usd ?? null,
      marketCapUsd: best.marketCap ?? null,
      fdvUsd: best.fdv ?? null,
      volume24hUsd: best.volume?.h24 ?? null,
      priceChange24hPct: best.priceChange?.h24 ?? null,
      pairAddress: best.pairAddress ?? null,
      dexName: best.dexId ?? null,
      pairCreatedAt: best.pairCreatedAt ? new Date(best.pairCreatedAt) : null,
      chartUrl: best.url && best.url.startsWith('https://dexscreener.com/') ? best.url : null,
      holderCount: null, // not provided by DexScreener
      fetchedAt: Date.now(),
    };
  }

  private async requestJson(url: string): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'agalio-buybot/1.0' },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 500 * 2 ** attempt;
          lastErr = new ExternalServiceError(`HTTP ${res.status}`, this.name, true, wait);
          if (attempt < this.opts.maxRetries) await this.sleep(wait);
          continue;
        }
        if (res.status === 404) return [];
        if (!res.ok) throw new ExternalServiceError(`HTTP ${res.status}`, this.name, false);
        return await res.json();
      } catch (err) {
        if (err instanceof ExternalServiceError && !err.retryable) throw err;
        lastErr = err;
        if (attempt < this.opts.maxRetries) await this.sleep(500 * 2 ** attempt);
      }
    }
    this.log.warn({ err: lastErr }, 'DexScreener request failed after retries');
    throw new ExternalServiceError(`DexScreener unavailable: ${errMessage(lastErr)}`, this.name);
  }
}
