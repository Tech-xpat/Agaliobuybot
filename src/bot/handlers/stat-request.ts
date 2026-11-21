import { buildStatReply } from '../../announcements/stat-reply';
import type { StatTopic } from '../../detection/stat-keyword-detector';
import type { BotDeps } from '../context';

const MARKET_TOPICS: StatTopic[] = ['price', 'marketcap', 'fdv', 'liquidity', 'volume', 'holders'];
const CHAIN_TOPICS: StatTopic[] = ['supply', 'decimals'];

/**
 * Looks up only the data the asked-for stats need (market data and/or on-chain facts) and builds
 * the short reply. Returns null when there is no official contract yet.
 */
export async function buildStatReplyFor(deps: BotDeps, topics: StatTopic[]): Promise<string | null> {
  const official = await deps.repos.tokens.getOfficial();
  if (!official?.contract) return null;
  const address = official.contract.checksum;

  const [market, onchain] = await Promise.all([
    topics.some((t) => MARKET_TOPICS.includes(t))
      ? deps.market.get(address)
      : Promise.resolve({ status: 'ok' as const, data: null, stale: false, providerName: '' }),
    topics.some((t) => CHAIN_TOPICS.includes(t)) ? deps.tokenSvc.getOnChain(address) : Promise.resolve(null),
  ]);

  return buildStatReply({ topics, symbol: official.token.symbol, onchain, market });
}
