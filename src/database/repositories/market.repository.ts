import type { MarketDataSnapshot } from '@prisma/client';
import type { MarketData } from '../../market-data/market.provider';
import type { Db } from '../prisma';

const s = (n: number | null) => (n === null ? null : String(n));

export class MarketRepository {
  constructor(private readonly db: Db) {}

  async save(tokenId: string, d: MarketData): Promise<void> {
    await this.db.marketDataSnapshot.create({
      data: {
        tokenId,
        provider: d.provider,
        priceUsd: s(d.priceUsd),
        liquidityUsd: s(d.liquidityUsd),
        marketCapUsd: s(d.marketCapUsd),
        fdvUsd: s(d.fdvUsd),
        volume24hUsd: s(d.volume24hUsd),
        priceChange24h: s(d.priceChange24hPct),
        pairAddress: d.pairAddress,
        dexName: d.dexName,
        chartUrl: d.chartUrl,
        pairCreatedAt: d.pairCreatedAt,
      },
    });
  }

  async latest(tokenId: string): Promise<MarketDataSnapshot | null> {
    return this.db.marketDataSnapshot.findFirst({ where: { tokenId }, orderBy: { fetchedAt: 'desc' } });
  }

  /** Keep the table small: drop snapshots older than `days`. */
  async prune(days = 14): Promise<number> {
    const res = await this.db.marketDataSnapshot.deleteMany({ where: { fetchedAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
    return res.count;
  }
}
