import { Contract, formatUnits } from 'ethers';
import type { Api } from 'grammy';
import type { Logger } from 'pino';
import type { BscProvider } from '../blockchain/bsc.provider';
import type { ContractService } from '../blockchain/contract.service';
import type { TokenService } from '../blockchain/token.service';
import type { AnnouncementService } from '../announcements/announcement.service';
import { WBNB } from '../config/constants';
import type { Env } from '../config/env';
import type { Repositories } from '../database/repositories';
import type { MarketData } from '../market-data/market.provider';
import type { MarketService } from '../market-data/market.service';
import type { CacheService } from '../services/cache.service';
import { errMessage } from '../utils/errors';
import { escapeHtml } from '../utils/sanitizers';
import { formatAmount } from '../utils/formatters';
import { buildBuyCard } from './buy-card';
import { SWAP_TOPICS, parseBuy, type ParsedBuy, type PoolInfo } from './swap-parser';

/** BSC stablecoins: for these the USD value of a buy is the amount paid. Lowercase. */
const STABLES = new Set([
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', // FDUSD
]);
const WBNB_LOWER = WBNB.toLowerCase();

/** Public RPCs cap getLogs ranges, so ask for small chunks. */
const CHUNK_BLOCKS = 500;
/** Never replay more than this many blocks (after downtime): old buys are noise, not news. */
const MAX_LOOKBACK_BLOCKS = 1500;
const CONFIRMATIONS = 1;
const DAY = 86_400;

const POOL_ABI = ['function token0() view returns (address)', 'function token1() view returns (address)'];
const ERC20_META_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

interface QuoteMeta {
  symbol: string;
  decimals: number;
}

export interface BuyAlertDeps {
  env: Env;
  log: Logger;
  repos: Repositories;
  cache: CacheService;
  bsc: BscProvider;
  contracts: ContractService;
  market: MarketService;
  tokenSvc: TokenService;
  announcements: AnnouncementService;
  /** Returns the live bot API, or null before the bot is ready. */
  getApi: () => Api | null;
}

interface PendingAlert {
  buy: ParsedBuy;
  usd: number | null;
  quote: QuoteMeta;
}

/**
 * Watches the official token's DEX pools for buys by reading Swap events from BSC logs, and posts a
 * "smart card" in the group for each one. Progress (last scanned block) and de-duplication live in the cache,
 * so a restart neither repeats alerts nor replays history. Nothing here ever touches funds or keys.
 */
export class BuyAlertService {
  private running = false;

  constructor(private readonly d: BuyAlertDeps) {}

  /** One scan: safe to call on a timer. Overlapping calls are skipped. */
  async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.scanOnce();
    } finally {
      this.running = false;
    }
  }

  private async scanOnce(): Promise<void> {
    const { env, repos, cache, bsc, log } = this.d;
    if (!env.BUY_ALERT_ENABLED) return;
    const cfg = await repos.config.get();
    if (!cfg.announcementEnabled || cfg.paused) return;
    const official = await repos.tokens.getOfficial();
    if (!official?.contract) return;
    const api = this.d.getApi();
    if (!api) return;

    const contract = official.contract.address; // lowercase
    const head = await bsc.call('blockNumber', (p) => p.getBlockNumber());
    const to = head - CONFIRMATIONS;
    const lastKey = `buy:last:${contract}`;
    const last = await cache.getJson<number>(lastKey);
    if (last === null || typeof last !== 'number') {
      // First run for this contract: start from now, never replay history.
      await cache.setJson(lastKey, to, 7 * DAY);
      return;
    }
    const from = Math.max(last + 1, to - MAX_LOOKBACK_BLOCKS + 1);
    if (from > to) return;

    const pools = await this.resolvePools(contract, official.contract.checksum);
    if (pools.length === 0) return; // no pool yet: keep the range, try again next scan

    const buys = await this.collectBuys(pools, contract, from, to);
    if (buys.length > 0) {
      const sent = await this.alert(api, buys, official.contract.checksum);
      if (!sent) return; // a Telegram failure: do not advance, the range is retried (sent alerts are de-duplicated)
    }
    await cache.setJson(lastKey, to, 7 * DAY);
    log.debug({ from, to, buys: buys.length }, 'Buy scan done');
  }

  // --- finding buys ----------------------------------------------------------------------

  private async resolvePools(contract: string, checksum: string): Promise<PoolInfo[]> {
    const addresses = new Set<string>();
    const market = await this.d.market.get(checksum);
    const best = market.data?.pairAddress;
    if (best && /^0x[0-9a-fA-F]{40}$/.test(best)) addresses.add(best.toLowerCase());

    const v2Key = `buy:v2pair:${contract}`;
    let v2 = await this.d.cache.getJson<{ pair: string | null }>(v2Key);
    if (!v2) {
      v2 = { pair: await this.d.contracts.findV2Pair(checksum) };
      await this.d.cache.setJson(v2Key, v2, v2.pair ? DAY : 120);
    }
    if (v2.pair) addresses.add(v2.pair.toLowerCase());

    const pools: PoolInfo[] = [];
    for (const address of addresses) {
      const info = await this.getPool(address);
      if (info) pools.push(info);
    }
    return pools;
  }

  private async getPool(address: string): Promise<PoolInfo | null> {
    const key = `buy:pool:${address}`;
    const hit = await this.d.cache.getJson<PoolInfo>(key);
    if (hit) return hit;
    try {
      const [token0, token1] = await this.d.bsc.call('pool.tokens', async (p) => {
        const c = new Contract(address, POOL_ABI, p);
        return Promise.all([c.getFunction('token0')() as Promise<string>, c.getFunction('token1')() as Promise<string>]);
      });
      const info: PoolInfo = { address, token0: token0.toLowerCase(), token1: token1.toLowerCase() };
      await this.d.cache.setJson(key, info, DAY);
      return info;
    } catch (err) {
      this.d.log.warn({ err: errMessage(err), pool: address }, 'Could not read pool tokens, skipping this pool');
      return null;
    }
  }

  private async collectBuys(pools: PoolInfo[], token: string, from: number, to: number): Promise<ParsedBuy[]> {
    const byAddress = new Map(pools.map((p) => [p.address, p]));
    const out: ParsedBuy[] = [];
    for (let start = from; start <= to; start += CHUNK_BLOCKS) {
      const end = Math.min(to, start + CHUNK_BLOCKS - 1);
      const logs = await this.d.bsc.call('getLogs', (p) =>
        p.getLogs({ address: pools.map((x) => x.address), fromBlock: start, toBlock: end, topics: [SWAP_TOPICS] }),
      );
      for (const log of logs) {
        const pool = byAddress.get(log.address.toLowerCase());
        if (!pool) continue;
        const buy = parseBuy(log, pool, token);
        if (buy) out.push(buy);
      }
    }
    return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  // --- posting ------------------------------------------------------------------------------

  /** Returns false when Telegram refused a card, so the caller keeps the range for a retry. */
  private async alert(api: Api, buys: ParsedBuy[], checksum: string): Promise<boolean> {
    const { env, cache, log } = this.d;
    const onchain = await this.d.tokenSvc.getOnChain(checksum);
    const decimals = onchain?.decimals ?? 18;
    const market = await this.d.market.get(checksum);
    const priceUsd = market.data?.priceUsd ?? null;
    const marketForUsd = market.data;

    const pending: PendingAlert[] = [];
    for (const buy of buys) {
      const quote = await this.quoteMeta(buy.quoteToken);
      const usd = estimateUsd(buy, quote, decimals, marketForUsd);
      if (usd !== null && usd < env.BUY_ALERT_MIN_USD) continue;
      pending.push({ buy, usd, quote });
    }

    const fresh: PendingAlert[] = [];
    for (const p of pending) {
      if (await cache.setNx(`buy:seen:${p.buy.txHash}:${p.buy.logIndex}`, 2 * DAY)) fresh.push(p);
    }
    if (fresh.length === 0) return true;

    // Flood control: show the biggest buys as cards, summarise the rest.
    const max = env.BUY_ALERT_MAX_PER_SCAN;
    const shown = [...fresh].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, max);
    const shownSet = new Set(shown);
    const ordered = fresh.filter((p) => shownSet.has(p));
    const hidden = fresh.length - ordered.length;

    const token = await this.d.repos.tokens.getToken();
    const buttons = token ? await this.d.repos.tokens.getButtonSettings(token.id) : [];
    const symbol = token?.symbol ?? onchain?.symbol ?? 'TOKEN';

    for (const p of ordered) {
      try {
        const buyer = await this.buyerOf(p.buy);
        const card = buildBuyCard({
          symbol,
          tokenAmountText: formatAmount(p.buy.tokenAmount, decimals),
          quoteAmountText: formatAmount(p.buy.quoteAmount, p.quote.decimals),
          quoteSymbol: p.quote.symbol,
          usd: p.usd,
          buyer,
          priceUsd,
          marketCapUsd: market.data?.marketCapUsd ?? null,
          liquidityUsd: market.data?.liquidityUsd ?? null,
          bscscanBaseUrl: env.BSCSCAN_BASE_URL,
          txHash: p.buy.txHash,
          token: { launchStatus: token?.launchStatus ?? 'PRE_LAUNCH', buyUrl: token?.buyUrl ?? null, chartUrl: token?.chartUrl ?? null },
          marketChartUrl: market.data?.chartUrl ?? null,
          contractChecksum: checksum,
          buttons,
        });
        await this.d.announcements.send(api, env.TELEGRAM_GROUP_ID, card);
      } catch (err) {
        log.error({ err: errMessage(err), tx: p.buy.txHash }, 'Failed to post a buy alert');
        await cache.del(`buy:seen:${p.buy.txHash}:${p.buy.logIndex}`);
        for (const rest of ordered.slice(ordered.indexOf(p) + 1)) await cache.del(`buy:seen:${rest.buy.txHash}:${rest.buy.logIndex}`);
        await this.d.repos.audit.event('error', 'buy-alert.failed', errMessage(err), { tx: p.buy.txHash });
        return false;
      }
    }

    if (hidden > 0) {
      try {
        await api.sendMessage(env.TELEGRAM_GROUP_ID, `🟢 <b>+${hidden} more ${escapeHtml(symbol)} buy${hidden === 1 ? '' : 's'}</b> just now`, { parse_mode: 'HTML' });
      } catch (err) {
        log.warn({ err: errMessage(err) }, 'Could not post the buy summary line');
      }
    }
    return true;
  }

  /** The wallet that sent the transaction is the real buyer; the swap recipient may be a router. */
  private async buyerOf(buy: ParsedBuy): Promise<string> {
    try {
      const tx = await this.d.bsc.call('getTransaction', (p) => p.getTransaction(buy.txHash));
      if (tx?.from) return tx.from.toLowerCase();
    } catch {
      /* fall back to the swap recipient */
    }
    return buy.recipient || buy.txHash;
  }

  private async quoteMeta(token: string): Promise<QuoteMeta> {
    if (token === WBNB_LOWER) return { symbol: 'BNB', decimals: 18 };
    const key = `buy:quote:${token}`;
    const hit = await this.d.cache.getJson<QuoteMeta>(key);
    if (hit) return hit;
    try {
      const [symbol, decimals] = await this.d.bsc.call('quote.meta', async (p) => {
        const c = new Contract(token, ERC20_META_ABI, p);
        return Promise.all([c.getFunction('symbol')() as Promise<string>, c.getFunction('decimals')() as Promise<bigint>]);
      });
      const meta: QuoteMeta = { symbol: String(symbol).slice(0, 12) || '?', decimals: Number(decimals) };
      await this.d.cache.setJson(key, meta, DAY);
      return meta;
    } catch {
      return { symbol: 'tokens', decimals: 18 };
    }
  }
}

/**
 * USD value of a buy. Best source first: stablecoin pairs (exact), then the quote token's USD price
 * from the market data (what was actually paid), then tokens bought × current token price (approximate).
 */
export function estimateUsd(
  buy: ParsedBuy,
  quote: QuoteMeta,
  tokenDecimals: number,
  market: Pick<MarketData, 'priceUsd' | 'quoteUsd' | 'quoteTokenAddress'> | null,
): number | null {
  if (STABLES.has(buy.quoteToken)) return Number(formatUnits(buy.quoteAmount, quote.decimals));
  if (market?.quoteUsd && market.quoteUsd > 0 && market.quoteTokenAddress === buy.quoteToken) {
    return Number(formatUnits(buy.quoteAmount, quote.decimals)) * market.quoteUsd;
  }
  if (market?.priceUsd && market.priceUsd > 0) return Number(formatUnits(buy.tokenAmount, tokenDecimals)) * market.priceUsd;
  return null;
}
