import { getAddress } from 'ethers';
import pino from 'pino';
import { loadEnv, type Env } from '../../src/config/env';
import type { OnChainTokenData } from '../../src/blockchain/contract.service';
import type { MarketData, MarketResult } from '../../src/market-data/market.provider';
import type { AnnouncementContext } from '../../src/types';

/** Deterministic, valid, checksummed addresses used only in tests. */
export const OFFICIAL = getAddress('0x1234567890abcdef1234567890abcdef12345678');
export const OTHER = getAddress('0x55d398326f99059ff775485246999027b3197955'); // BSC-USD, a random other token
export const GROUP_ID = -1001234567890;
export const ADMIN_ID = 1001;
export const MEMBER_ID = 2002;
export const BOT_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const silentLog = pino({ level: 'silent' });

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_GROUP_ID: String(GROUP_ID),
    TELEGRAM_ADMIN_IDS: `${ADMIN_ID}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    BSC_RPC_URL: 'https://rpc.invalid.example',
    ANNOUNCEMENT_COOLDOWN_SECONDS: '60',
    ...overrides,
  });
}

export const onchain: OnChainTokenData = {
  address: OFFICIAL,
  hasCode: true,
  name: 'AGALIO',
  symbol: 'AGALIO',
  decimals: 18,
  totalSupply: '1000000000000000000000000000',
  fetchedAt: Date.now(),
  failedFields: [],
};

export const marketData: MarketData = {
  provider: 'DexScreener',
  priceUsd: 0.000123,
  liquidityUsd: 54_321,
  marketCapUsd: 1_230_000,
  fdvUsd: 1_230_000,
  volume24hUsd: 9_876,
  priceChange24hPct: 4.2,
  pairAddress: '0x00000000000000000000000000000000000000aa',
  dexName: 'pancakeswap',
  pairCreatedAt: new Date('2026-01-01T00:00:00Z'),
  chartUrl: 'https://dexscreener.com/bsc/0x00000000000000000000000000000000000000aa',
  holderCount: null,
  fetchedAt: Date.now(),
};

export const marketOk: MarketResult = { status: 'ok', data: marketData, stale: false, providerName: 'DexScreener' };
export const marketNoPair: MarketResult = { status: 'no_pair', data: null, stale: false, providerName: 'DexScreener' };
export const marketDown: MarketResult = { status: 'unavailable', data: null, stale: false, providerName: 'DexScreener' };

export function baseContext(over: Partial<AnnouncementContext> = {}): AnnouncementContext {
  return {
    token: {
      name: 'AGALIO',
      symbol: 'AGALIO',
      description: 'Official AGALIO token.',
      launchStatus: 'CONTRACT_DEPLOYED',
      buyUrl: null,
      chartUrl: null,
      communityUrl: null,
      websiteUrl: null,
      twitterUrl: null,
      whitepaperUrl: null,
      tokenomicsUrl: null,
      securityUrl: null,
      tutorialUrl: null,
    },
    contract: { checksum: OFFICIAL, lower: OFFICIAL.toLowerCase() },
    onchain,
    market: marketNoPair,
    buttons: [],
    template: null,
    kind: 'AUTO',
    bscscanBaseUrl: 'https://bscscan.com',
    telegramGroupUrl: 'https://t.me/agalionetwork',
    ...over,
  };
}
