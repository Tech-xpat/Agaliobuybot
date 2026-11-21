import { UNAVAILABLE } from '../config/constants';
import type { OnChainTokenData } from '../blockchain/contract.service';
import type { StatTopic } from '../detection/stat-keyword-detector';
import type { MarketResult } from '../market-data/market.provider';
import { escapeHtml } from '../utils/sanitizers';
import { formatSupply, formatUsdCompact, formatUsdPrice } from '../utils/formatters';

export interface StatReplyInput {
  topics: StatTopic[];
  symbol: string;
  onchain: OnChainTokenData | null;
  market: MarketResult;
}

const MARKET_TOPICS = new Set<StatTopic>(['price', 'marketcap', 'fdv', 'liquidity', 'volume', 'holders']);

/**
 * Builds the short group reply for "price", "mc", "liquidity" … requests: one line per asked stat,
 * nothing else. Returns null when there is nothing to say.
 */
export function buildStatReply(input: StatReplyInput): string | null {
  const { topics, symbol, onchain, market } = input;
  if (topics.length === 0) return null;
  const m = market.status === 'ok' ? market.data : null;
  const sym = escapeHtml(symbol);

  const line = (topic: StatTopic): string => {
    switch (topic) {
      case 'price':
        return `💰 <b>${sym} price:</b> ${escapeHtml(formatUsdPrice(m?.priceUsd))}`;
      case 'marketcap':
        return `📊 <b>Market cap:</b> ${escapeHtml(formatUsdCompact(m?.marketCapUsd))}`;
      case 'fdv':
        return `📈 <b>FDV:</b> ${escapeHtml(formatUsdCompact(m?.fdvUsd))}`;
      case 'liquidity':
        return `💧 <b>Liquidity:</b> ${escapeHtml(formatUsdCompact(m?.liquidityUsd))}`;
      case 'volume':
        return `🔄 <b>24h volume:</b> ${escapeHtml(formatUsdCompact(m?.volume24hUsd))}`;
      case 'holders':
        return `👥 <b>Holders:</b> ${m?.holderCount != null ? m.holderCount.toLocaleString('en-US') : 'not provided by the data source'}`;
      case 'supply':
        return `🪙 <b>Total supply:</b> ${escapeHtml(formatSupply(onchain?.totalSupply, onchain?.decimals))}`;
      case 'decimals':
        return `🔢 <b>Decimals:</b> ${onchain?.decimals != null ? onchain.decimals : UNAVAILABLE}`;
    }
  };

  const lines = topics.map(line);
  if (topics.some((t) => MARKET_TOPICS.has(t))) {
    if (market.status === 'no_pair') lines.push('<i>No trading pair found yet.</i>');
    else if (market.status === 'unavailable') lines.push('<i>Market data is temporarily unavailable.</i>');
    else if (market.stale) lines.push(`<i>Source: ${escapeHtml(market.providerName)} (cached, may be outdated)</i>`);
    else lines.push(`<i>Source: ${escapeHtml(market.providerName)}</i>`);
  }
  return lines.join('\n');
}
