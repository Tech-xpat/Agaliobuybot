import type { Logger } from 'pino';
import type { CacheService } from '../services/cache.service';
import type { ContractService, OnChainTokenData } from './contract.service';

const TTL_SECONDS = 300;
const key = (address: string) => `onchain:${address.toLowerCase()}`;

/** Cached, failure-tolerant access to verified on-chain facts about a token. */
export class TokenService {
  constructor(
    private readonly contracts: ContractService,
    private readonly cache: CacheService,
    private readonly log: Logger,
  ) {}

  async getOnChain(address: string, opts: { force?: boolean } = {}): Promise<OnChainTokenData | null> {
    if (!opts.force) {
      const hit = await this.cache.getJson<OnChainTokenData>(key(address));
      if (hit) return hit;
    }
    try {
      const data = await this.contracts.getTokenData(address);
      // Cache real results; cache "no code yet" only briefly so launch is noticed quickly.
      await this.cache.setJson(key(address), data, data.hasCode ? TTL_SECONDS : 20);
      if (data.hasCode) await this.remember(address, data);
      return data;
    } catch (err) {
      this.log.warn({ err, address }, 'On-chain token lookup failed');
      const stale = await this.cache.getJson<OnChainTokenData>(`${key(address)}:last`);
      return stale;
    }
  }

  async remember(address: string, data: OnChainTokenData): Promise<void> {
    await this.cache.setJson(`${key(address)}:last`, data, 86_400);
  }

  async invalidate(address: string): Promise<void> {
    await this.cache.del(key(address));
  }
}
