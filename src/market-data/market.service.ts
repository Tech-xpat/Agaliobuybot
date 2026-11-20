import type { Logger } from 'pino';
import type { CacheService } from '../services/cache.service';
import type { MarketData, MarketDataProvider, MarketResult } from './market.provider';

interface CachedEntry {
  status: 'ok' | 'no_pair';
  data: MarketData | null;
  providerName: string;
}

export interface MarketServiceOptions {
  refreshSeconds: number;
}

/**
 * Provider-agnostic market data with caching. The announcement code only sees
 * MarketResult, so providers can be swapped or chained without touching it.
 */
export class MarketService {
  constructor(
    private readonly providers: MarketDataProvider[],
    private readonly cache: CacheService,
    private readonly log: Logger,
    private readonly opts: MarketServiceOptions,
  ) {
    if (providers.length === 0) throw new Error('MarketService needs at least one provider');
  }

  private fresh = (a: string) => `market:fresh:${a.toLowerCase()}`;
  private last = (a: string) => `market:last:${a.toLowerCase()}`;

  async get(address: string, opts: { force?: boolean } = {}): Promise<MarketResult> {
    if (!opts.force) {
      const hit = await this.cache.getJson<CachedEntry>(this.fresh(address));
      if (hit) return { ...hit, stale: false };
    }

    let lastError: unknown;
    let anyHealthy = false;
    for (const provider of this.providers) {
      try {
        const data = await provider.getTokenMarketData(address);
        anyHealthy = true;
        if (data) {
          const entry: CachedEntry = { status: 'ok', data, providerName: provider.name };
          await this.store(address, entry);
          return { ...entry, stale: false };
        }
      } catch (err) {
        lastError = err;
        this.log.warn({ err, provider: provider.name }, 'Market provider failed');
      }
    }

    if (anyHealthy) {
      // Reachable, but no pair listed anywhere: do NOT pretend data exists.
      const entry: CachedEntry = { status: 'no_pair', data: null, providerName: this.providers[0]!.name };
      await this.store(address, entry);
      return { ...entry, stale: false };
    }

    const stale = await this.cache.getJson<CachedEntry>(this.last(address));
    if (stale && stale.status === 'ok') return { ...stale, stale: true };
    this.log.warn({ err: lastError }, 'No market data available');
    return { status: 'unavailable', data: null, stale: false, providerName: this.providers[0]!.name };
  }

  private async store(address: string, entry: CachedEntry): Promise<void> {
    await this.cache.setJson(this.fresh(address), entry, this.opts.refreshSeconds);
    if (entry.status === 'ok') await this.cache.setJson(this.last(address), entry, 86_400);
  }

  async invalidate(address: string): Promise<void> {
    await this.cache.del(this.fresh(address));
  }
}
