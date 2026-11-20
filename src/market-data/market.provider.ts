export interface MarketData {
  provider: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  pairAddress: string | null;
  dexName: string | null;
  pairCreatedAt: Date | null;
  chartUrl: string | null;
  holderCount: number | null;
  fetchedAt: number;
}

/**
 * Provider contract. `getTokenMarketData` returns null when the provider is
 * healthy but has no pair for the token; it throws ExternalServiceError when
 * the provider itself is unavailable.
 */
export interface MarketDataProvider {
  readonly name: string;
  getTokenMarketData(address: string): Promise<MarketData | null>;
}

export type MarketStatus = 'ok' | 'no_pair' | 'unavailable';

export interface MarketResult {
  status: MarketStatus;
  data: MarketData | null;
  /** true when data comes from an older cached copy because the provider failed */
  stale: boolean;
  providerName: string;
}
