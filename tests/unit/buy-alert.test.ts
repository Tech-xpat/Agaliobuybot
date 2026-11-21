import { AbiCoder, parseUnits } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import type { BscProvider } from '../../src/blockchain/bsc.provider';
import { buildBuyCard, buyBar } from '../../src/buy-alerts/buy-card';
import { BuyAlertService, estimateUsd, type BuyAlertDeps } from '../../src/buy-alerts/buy-alert.service';
import { V2_SWAP_TOPIC, V3_PANCAKE_SWAP_TOPIC, V3_SWAP_TOPIC, parseBuy, type PoolInfo, type RawLog } from '../../src/buy-alerts/swap-parser';
import { WBNB } from '../../src/config/constants';
import { CacheService } from '../../src/services/cache.service';
import { formatAmount } from '../../src/utils/formatters';
import { marketData, marketOk, OFFICIAL, onchain, silentLog, testEnv } from '../fixtures';

const coder = AbiCoder.defaultAbiCoder();
const POOL = '0x00000000000000000000000000000000000000aa';
const TOKEN = OFFICIAL.toLowerCase();
const WBNB_L = WBNB.toLowerCase();
const BUYER = '0x00000000000000000000000000000000000000b1';
const pad = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;
const poolT0: PoolInfo = { address: POOL, token0: TOKEN, token1: WBNB_L }; // token is token0
const poolT1: PoolInfo = { address: POOL, token0: WBNB_L, token1: TOKEN }; // token is token1
const E18 = (n: string) => parseUnits(n, 18);

function v2Log(a: { in0?: bigint; in1?: bigint; out0?: bigint; out1?: bigint }, extra: Partial<RawLog> = {}): RawLog {
  return {
    address: POOL,
    topics: [V2_SWAP_TOPIC, pad('0x00000000000000000000000000000000000000cc'), pad(BUYER)],
    data: coder.encode(['uint256', 'uint256', 'uint256', 'uint256'], [a.in0 ?? 0n, a.in1 ?? 0n, a.out0 ?? 0n, a.out1 ?? 0n]),
    transactionHash: '0x' + 'ab'.repeat(32),
    index: 7,
    blockNumber: 1005,
    ...extra,
  };
}
function v3Log(amount0: bigint, amount1: bigint, topic = V3_SWAP_TOPIC): RawLog {
  const types = topic === V3_SWAP_TOPIC ? ['int256', 'int256', 'uint160', 'uint128', 'int24'] : ['int256', 'int256', 'uint160', 'uint128', 'int24', 'uint128', 'uint128'];
  const values = topic === V3_SWAP_TOPIC ? [amount0, amount1, 1n, 1n, 1] : [amount0, amount1, 1n, 1n, 1, 0n, 0n];
  return { address: POOL, topics: [topic, pad('0x00000000000000000000000000000000000000cc'), pad(BUYER)], data: coder.encode(types, values), transactionHash: '0x' + 'cd'.repeat(32), index: 2, blockNumber: 1006 };
}

describe('parseBuy', () => {
  it('V2 buy where the token is token0: pool pays token0 out, BNB in', () => {
    const b = parseBuy(v2Log({ in1: E18('2'), out0: E18('1000') }), poolT0, TOKEN)!;
    expect(b.tokenAmount).toBe(E18('1000'));
    expect(b.quoteAmount).toBe(E18('2'));
    expect(b.quoteToken).toBe(WBNB_L);
    expect(b.recipient).toBe(BUYER);
    expect(b.logIndex).toBe(7);
  });

  it('V2 buy where the token is token1', () => {
    const b = parseBuy(v2Log({ in0: E18('2'), out1: E18('1000') }), poolT1, TOKEN)!;
    expect(b.tokenAmount).toBe(E18('1000'));
    expect(b.quoteAmount).toBe(E18('2'));
  });

  it('ignores V2 sells (token goes in, BNB comes out)', () => {
    expect(parseBuy(v2Log({ in0: E18('1000'), out1: E18('2') }), poolT0, TOKEN)).toBeNull();
    expect(parseBuy(v2Log({ in1: E18('1000'), out0: E18('2') }), poolT1, TOKEN)).toBeNull();
  });

  it.each([V3_SWAP_TOPIC, V3_PANCAKE_SWAP_TOPIC])('V3 buy (negative token delta) on %s', (topic) => {
    const b = parseBuy(v3Log(-E18('500'), E18('1'), topic), poolT0, TOKEN)!;
    expect(b.tokenAmount).toBe(E18('500'));
    expect(b.quoteAmount).toBe(E18('1'));
    expect(parseBuy(v3Log(E18('1'), -E18('500'), topic), poolT1, TOKEN)!.tokenAmount).toBe(E18('500'));
  });

  it('ignores V3 sells, unknown events, other tokens and garbage data', () => {
    expect(parseBuy(v3Log(E18('500'), -E18('1')), poolT0, TOKEN)).toBeNull();
    expect(parseBuy({ ...v2Log({ in1: 1n, out0: 1n }), topics: ['0x' + '11'.repeat(32)] }, poolT0, TOKEN)).toBeNull();
    expect(parseBuy(v2Log({ in1: E18('2'), out0: E18('1000') }), poolT0, '0x' + '99'.repeat(20))).toBeNull();
    expect(parseBuy({ ...v2Log({}), data: '0x1234' }, poolT0, TOKEN)).toBeNull();
    expect(parseBuy({ ...v3Log(-1n, 1n), data: '0x1234' }, poolT0, TOKEN)).toBeNull();
  });
});

describe('amount and value helpers', () => {
  it('formatAmount', () => {
    expect(formatAmount(E18('1234567.891'), 18)).toBe('1,234,567.89');
    expect(formatAmount(E18('2'), 18)).toBe('2');
    expect(formatAmount(parseUnits('0.000123', 18), 18)).toBe('0.000123');
    expect(formatAmount(1n, 18)).toBe('<0.000001');
  });

  it('USD: exact for stablecoin pairs, price-based otherwise, null without a price', () => {
    const base = { txHash: '0x1', logIndex: 0, blockNumber: 1, pool: POOL, tokenAmount: E18('1000'), quoteAmount: E18('50'), recipient: BUYER };
    const usdt = '0x55d398326f99059ff775485246999027b3197955';
    const bnb = { symbol: 'BNB', decimals: 18 };
    const price = { priceUsd: 0.5, quoteUsd: null, quoteTokenAddress: null };
    expect(estimateUsd({ ...base, quoteToken: usdt }, { symbol: 'USDT', decimals: 18 }, 18, price)).toBe(50);
    expect(estimateUsd({ ...base, quoteToken: WBNB_L }, bnb, 18, price)).toBe(500); // tokens × price fallback
    expect(estimateUsd({ ...base, quoteToken: WBNB_L }, bnb, 18, { ...price, quoteUsd: 600, quoteTokenAddress: WBNB_L })).toBe(30_000); // 50 BNB × $600
    expect(estimateUsd({ ...base, quoteToken: WBNB_L }, bnb, 18, { ...price, quoteUsd: 600, quoteTokenAddress: usdt })).toBe(500); // other quote: not used
    expect(estimateUsd({ ...base, quoteToken: WBNB_L }, bnb, 18, null)).toBeNull();
  });

  it('buyBar scales with size, min 1 and capped', () => {
    expect(buyBar(null)).toBe('🟢');
    expect(buyBar(10)).toBe('🟢');
    expect(Array.from(buyBar(100)).length).toBe(4);
    expect(Array.from(buyBar(1_000_000)).length).toBe(30);
  });
});

describe('buy card', () => {
  const input = {
    symbol: 'AGA<LIO>',
    tokenAmountText: '1,000',
    quoteAmountText: '2',
    quoteSymbol: 'BNB',
    usd: 1200,
    buyer: BUYER,
    priceUsd: 0.000123,
    marketCapUsd: 1_230_000,
    liquidityUsd: 54_321,
    bscscanBaseUrl: 'https://bscscan.com',
    txHash: '0x' + 'ab'.repeat(32),
    token: { launchStatus: 'TRADING_LIVE', buyUrl: 'https://pancakeswap.finance/swap?outputCurrency={contract}', chartUrl: null as string | null },
    marketChartUrl: 'https://dexscreener.com/bsc/0xaa',
    contractChecksum: OFFICIAL,
    buttons: [],
  };

  it('shows the spend, tokens, buyer and market stats, with escaped values', () => {
    const { html } = buildBuyCard(input);
    expect(html).toContain('AGA&lt;LIO&gt; BUY!');
    expect(html).toContain('Spent:</b> 2 BNB ($1.20K)');
    expect(html).toContain('Got:</b> 1,000 AGA&lt;LIO&gt;');
    expect(html).toContain(`href="https://bscscan.com/address/${BUYER}"`);
    expect(html).toContain('Market cap:</b> $1.23M');
    expect(html).not.toMatch(/<(?!\/?(b|a)\b)[a-z]/i);
  });

  it('has TX, chart and buy buttons; buy only when trading is live', () => {
    const live = buildBuyCard(input).rows.flat();
    expect(live.map((b) => b.key)).toEqual(['bscscan', 'chart', 'buy']);
    expect(live[2]).toMatchObject({ url: `https://pancakeswap.finance/swap?outputCurrency=${OFFICIAL}` });
    const notLive = buildBuyCard({ ...input, token: { ...input.token, launchStatus: 'TRADING_NOT_LIVE' } }).rows.flat();
    expect(notLive.map((b) => b.key)).toEqual(['bscscan', 'chart']);
  });

  it('respects admin button switches and omits unknown stats', () => {
    const { html, rows } = buildBuyCard({ ...input, usd: null, priceUsd: null, marketCapUsd: null, liquidityUsd: null, buttons: [{ key: 'buy', enabled: false }, { key: 'chart', enabled: false }] });
    expect(rows.flat().map((b) => b.key)).toEqual(['bscscan']);
    expect(html).not.toContain('Market cap');
    expect(html).not.toContain('($');
  });
});

describe('BuyAlertService.scan', () => {
  function setup(overrides: Record<string, string> = {}, logsByScan: RawLog[][] = [], market = marketOk) {
    const env = testEnv({ BUY_ALERT_MIN_USD: '1', ...overrides });
    const cache = new CacheService(null, silentLog, `b${Math.random()}:`);
    let head = 1000;
    const getLogs = vi.fn(async () => logsByScan.shift() ?? []);
    const provider = {
      getBlockNumber: async () => head,
      getLogs,
      getTransaction: async () => ({ from: BUYER }),
    };
    const bsc = { call: async (_l: string, fn: (p: unknown) => unknown) => fn(provider) } as unknown as BscProvider;
    const sent: { chat: string | number; html: string; rows: unknown[][] }[] = [];
    const extra: string[] = [];
    const api = { sendMessage: async (_c: unknown, t: string) => void extra.push(t) };
    const deps = {
      env,
      log: silentLog,
      cache,
      bsc,
      repos: {
        config: { get: async () => ({ announcementEnabled: true, paused: false }) },
        tokens: {
          getOfficial: async () => ({ token: { symbol: 'AGALIO' }, contract: { address: TOKEN, checksum: OFFICIAL } }),
          getToken: async () => ({ symbol: 'AGALIO', launchStatus: 'TRADING_LIVE', buyUrl: null, chartUrl: null }),
          getButtonSettings: async () => [],
        },
        audit: { event: async () => undefined },
      },
      contracts: { findV2Pair: async () => null },
      market: { get: async () => market },
      tokenSvc: { getOnChain: async () => onchain },
      announcements: { send: async (_a: unknown, chat: string | number, card: { html: string; rows: unknown[][] }) => void sent.push({ chat, ...card }) },
      getApi: () => api,
    } as unknown as BuyAlertDeps;
    const svc = new BuyAlertService(deps);
    return {
      svc,
      sent,
      extra,
      cache,
      getLogs,
      setHead: (n: number) => (head = n),
      seedPool: () => cache.setJson(`buy:pool:${marketData.pairAddress!}`, { address: marketData.pairAddress!, token0: TOKEN, token1: WBNB_L }, 3600),
    };
  }
  // marketData.pairAddress is 0x…aa, the same as POOL
  const buy = (usd: string, tx = 'ab', index = 1, block = 1005): RawLog =>
    v2Log({ in1: E18(usd), out0: E18('1000000') }, { transactionHash: '0x' + tx.repeat(32), index, blockNumber: block });

  it('does nothing on the first scan (no history replay), then alerts on new buys in the group', async () => {
    const t = setup({}, [[buy('0.01')]]);
    await t.seedPool();
    await t.svc.scan(); // initialises at head
    expect(t.getLogs).not.toHaveBeenCalled();
    t.setHead(1010);
    await t.svc.scan();
    expect(t.sent).toHaveLength(1);
    expect(String(t.sent[0]!.chat)).toBe(String(testEnv().TELEGRAM_GROUP_ID));
    expect(t.sent[0]!.html).toContain('AGALIO BUY!');
    expect(t.sent[0]!.html).toContain('1,000,000 AGALIO');
    expect(t.sent[0]!.html).toContain('0.01 BNB');
  });

  it('never alerts twice for the same swap, and does not rescan old blocks', async () => {
    const t = setup({}, [[buy('0.01')], [buy('0.01')]]);
    await t.seedPool();
    await t.svc.scan();
    t.setHead(1010);
    await t.svc.scan();
    t.setHead(1020);
    await t.svc.scan(); // same log returned again by the node → de-duplicated
    expect(t.sent).toHaveLength(1);
  });

  it('skips dust below BUY_ALERT_MIN_USD (price-based estimate) and sells', async () => {
    // no BNB price in the fixture, so: 1,000,000 tokens × $0.000123 = $123, below the $200 threshold → skipped
    const t = setup({ BUY_ALERT_MIN_USD: '200' }, [[buy('0.5'), v2Log({ in0: E18('1000'), out1: E18('2') }, { index: 9 })]]);
    await t.seedPool();
    await t.svc.scan();
    t.setHead(1010);
    await t.svc.scan();
    expect(t.sent).toHaveLength(0);
  });

  it('flood control: biggest buys get cards, the rest one summary line', async () => {
    const logs = [buy('1', 'a1', 1), buy('3', 'a2', 2), buy('2', 'a3', 3), buy('4', 'a4', 4)];
    const withBnbPrice = { ...marketOk, data: { ...marketData, quoteTokenAddress: WBNB_L, quoteUsd: 600 } };
    const t = setup({ BUY_ALERT_MAX_PER_SCAN: '2' }, [logs], withBnbPrice);
    await t.seedPool();
    await t.svc.scan();
    t.setHead(1010);
    await t.svc.scan();
    expect(t.sent).toHaveLength(2);
    expect(t.sent.map((s) => s.html).join()).toContain('Spent:</b> 4 BNB ($2.40K)');
    expect(t.sent.map((s) => s.html).join()).toContain('Spent:</b> 3 BNB ($1.80K)');
    expect(t.extra).toHaveLength(1);
    expect(t.extra[0]).toContain('+2 more AGALIO buys');
  });

  it('is off when BUY_ALERT_ENABLED=false', async () => {
    const t = setup({ BUY_ALERT_ENABLED: 'false' }, [[buy('1')]]);
    await t.seedPool();
    await t.svc.scan();
    t.setHead(1010);
    await t.svc.scan();
    expect(t.getLogs).not.toHaveBeenCalled();
  });

  it('retries the range after a Telegram failure without duplicating cards already sent', async () => {
    const t = setup({}, [[buy('1', 'a1', 1), buy('2', 'a2', 2)], [buy('1', 'a1', 1), buy('2', 'a2', 2)]]);
    await t.seedPool();
    await t.svc.scan();
    t.setHead(1010);
    let calls = 0;
    const original = (t.svc as unknown as { d: { announcements: { send: (...a: unknown[]) => Promise<unknown> } } }).d.announcements.send;
    (t.svc as unknown as { d: { announcements: { send: (...a: unknown[]) => Promise<unknown> } } }).d.announcements.send = async (...a) => {
      calls += 1;
      if (calls === 2) throw new Error('429 Too Many Requests');
      return original(...a);
    };
    await t.svc.scan(); // 1st card ok, 2nd fails → range not advanced
    expect(t.sent).toHaveLength(1);
    await t.svc.scan(); // retried: the 1st is a duplicate, the 2nd is delivered
    expect(t.sent).toHaveLength(2);
  });
});
