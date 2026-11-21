import 'dotenv/config';
import { z } from 'zod';
import { BSC_CHAIN_ID } from './constants';
import { addressSchema, parseAdminIds } from './validation';

const empty = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(empty, z.string().trim().optional());
const optUrl = z.preprocess(empty, z.string().trim().url().optional());
const bool = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.enum(['true', 'false']).transform((v) => v === 'true'),
);
const int = (def: number, min: number, max: number) =>
  z.preprocess(empty, z.coerce.number().int().min(min).max(max).default(def));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{6,12}:[A-Za-z0-9_-]{30,}$/, 'Looks malformed (expected 123456:ABC...)'),
    TELEGRAM_GROUP_ID: z.string().regex(/^-?\d+$/, 'Must be a numeric chat ID, e.g. -1001234567890'),
    TELEGRAM_ADMIN_IDS: z.string().min(1),
    TELEGRAM_GROUP_URL: z.preprocess(empty, z.string().url().default('https://t.me/agalionetwork')),

    DATABASE_URL: z.string().min(1).startsWith('postgres'),
    REDIS_URL: z.string().min(1).startsWith('redis'),

    BSC_CHAIN_ID: z.preprocess(empty, z.coerce.number().default(BSC_CHAIN_ID)).refine((v) => v === BSC_CHAIN_ID, {
      message: 'BSC_CHAIN_ID must be 56 (BNB Smart Chain mainnet)',
    }),
    BSC_RPC_URL: z.string().url(),
    BSC_FALLBACK_RPC_URL: optUrl,
    RPC_TIMEOUT_MS: int(8000, 1000, 60000),
    RPC_MAX_RETRIES: int(3, 0, 10),
    BSCSCAN_BASE_URL: z.preprocess(empty, z.string().url().default('https://bscscan.com')),

    AGALIO_TOKEN_NAME: z.preprocess(empty, z.string().trim().min(1).max(64).default('AGALIO')),
    AGALIO_TOKEN_SYMBOL: z.preprocess(empty, z.string().trim().min(1).max(16).default('AGALIO')),
    AGALIO_CONTRACT_ADDRESS: z.preprocess(empty, addressSchema.optional()),
    AGALIO_BUY_URL: optUrl,
    AGALIO_CHART_URL: optUrl,
    AGALIO_COMMUNITY_URL: optUrl,
    AGALIO_WEBSITE_URL: optUrl,
    AGALIO_LOGO_PATH: z.preprocess(empty, z.string().default('assets/logo.png')),

    DEXSCREENER_API_BASE_URL: z.preprocess(empty, z.string().url().default('https://api.dexscreener.com')),
    MARKET_REFRESH_SECONDS: int(60, 15, 3600),
    MARKET_TIMEOUT_MS: int(8000, 1000, 60000),
    MARKET_MAX_RETRIES: int(2, 0, 6),

    BOT_MODE: z.preprocess(empty, z.enum(['polling', 'webhook']).default('polling')),
    WEBHOOK_URL: optUrl,
    WEBHOOK_SECRET: optStr,
    PORT: int(3000, 1, 65535),

    ANNOUNCEMENT_ENABLED: z.preprocess(empty, bool.default('true')),
    ANNOUNCEMENT_COOLDOWN_SECONDS: int(60, 0, 86400),
    USER_RATE_LIMIT_PER_MINUTE: int(20, 1, 600),

    // Buy alerts: a card is posted in the group whenever someone buys the official token.
    BUY_ALERT_ENABLED: z.preprocess(empty, bool.default('true')),
    BUY_ALERT_MIN_USD: z.preprocess(empty, z.coerce.number().min(0).max(1_000_000).default(1)),
    BUY_ALERT_POLL_SECONDS: int(10, 5, 300),
    BUY_ALERT_MAX_PER_SCAN: int(5, 1, 25),

    LOG_LEVEL: z.preprocess(empty, z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')),
  })
  .superRefine((v, ctx) => {
    if (v.BOT_MODE === 'webhook') {
      if (!v.WEBHOOK_URL || !v.WEBHOOK_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['WEBHOOK_URL'], message: 'Required (https) when BOT_MODE=webhook' });
      }
      if (!v.WEBHOOK_SECRET || !/^[A-Za-z0-9_-]{16,256}$/.test(v.WEBHOOK_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_SECRET'],
          message: 'Required when BOT_MODE=webhook: 16-256 chars of A-Z a-z 0-9 _ -',
        });
      }
    }
    try {
      parseAdminIds(v.TELEGRAM_ADMIN_IDS);
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: ['TELEGRAM_ADMIN_IDS'], message: (e as Error).message });
    }
  });

export type Env = Omit<z.infer<typeof schema>, 'TELEGRAM_ADMIN_IDS'> & { TELEGRAM_ADMIN_IDS: bigint[] };

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return { ...result.data, TELEGRAM_ADMIN_IDS: parseAdminIds(result.data.TELEGRAM_ADMIN_IDS) };
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
