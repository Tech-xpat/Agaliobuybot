import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { vi } from 'vitest';
import { AdminGuard } from '../../src/admin/admin.guard';
import { AdminService } from '../../src/admin/admin.service';
import { AnnouncementService } from '../../src/announcements/announcement.service';
import type { BscProvider } from '../../src/blockchain/bsc.provider';
import type { ContractService, OnChainTokenData } from '../../src/blockchain/contract.service';
import { TokenService } from '../../src/blockchain/token.service';
import { createBot } from '../../src/bot/bot';
import type { BotDeps } from '../../src/bot/context';
import type { Env } from '../../src/config/env';
import { createPrisma, type Db } from '../../src/database/prisma';
import { createRepositories } from '../../src/database/repositories';
import type { MarketData, MarketDataProvider } from '../../src/market-data/market.provider';
import { MarketService } from '../../src/market-data/market.service';
import type { BackgroundJobs } from '../../src/queue/workers';
import { CacheService } from '../../src/services/cache.service';
import { ADMIN_ID, GROUP_ID, MEMBER_ID, OFFICIAL, onchain, silentLog, testEnv } from '../fixtures';

export const TEST_DB = process.env.TEST_DATABASE_URL;

export async function resetDb(db: Db): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "Announcement","DetectedMessage","ButtonConfiguration","MarketDataSnapshot","ContractAddress","Token","BotConfiguration","TelegramGroup","Administrator","AuditLog","BotEvent" RESTART IDENTITY CASCADE',
  );
}

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

export interface Harness {
  db: Db;
  deps: BotDeps;
  bot: Bot;
  calls: ApiCall[];
  /** make the next call(s) to `method` fail with a Telegram error */
  failNext(method: string, error: { error_code: number; description: string; parameters?: { retry_after: number } }, times?: number): void;
  setMarket(data: MarketData | null | Error): void;
  setOnchain(data: OnChainTokenData | null): void;
  retryJobs: ReturnType<typeof vi.fn>;
  sent(): ApiCall[];
  send(update: Record<string, unknown>): Promise<void>;
  groupMessage(text: string, id?: number, userId?: number): Promise<void>;
  privateCommand(cmd: string, args?: string, userId?: number, extra?: Record<string, unknown>): Promise<void>;
  callback(data: string, userId?: number): Promise<void>;
  privateText(text: string, userId?: number): Promise<void>;
  privatePhoto(userId?: number): Promise<void>;
  /** a button press inside a private chat (admin panel) */
  panelPress(data: string, userId?: number): Promise<void>;
  /** a button press in the group chat */
  last(method: string): ApiCall | undefined;
  close(): Promise<void>;
}

let updateCounter = 1;
let queryCounter = 1;

export async function createHarness(opts: { seedContract?: boolean; env?: Env; cache?: CacheService } = {}): Promise<Harness> {
  const env = opts.env ?? testEnv();
  const db = createPrisma(TEST_DB!);
  await resetDb(db);
  const repos = createRepositories(db);
  await repos.config.ensure(env);
  await repos.tokens.ensureSeeded({ ...env, AGALIO_CONTRACT_ADDRESS: opts.seedContract === false ? undefined : OFFICIAL });
  await repos.groups.ensure(BigInt(GROUP_ID), 'AGALIO NETWORK');

  const cache = opts.cache ?? new CacheService(null, silentLog, `t${Date.now()}${Math.random()}:`);

  let marketState: MarketData | null | Error = null;
  let onchainState: OnChainTokenData | null = onchain;
  const provider: MarketDataProvider = {
    name: 'FakeDex',
    getTokenMarketData: async () => {
      if (marketState instanceof Error) throw marketState;
      return marketState;
    },
  };
  const market = new MarketService([provider], cache, silentLog, { refreshSeconds: 60 });
  const contracts = {
    hasCode: async () => onchainState?.hasCode ?? false,
    getTokenData: async () => {
      if (!onchainState) throw new Error('rpc down');
      return onchainState;
    },
  } as unknown as ContractService;
  const tokenSvc = new TokenService(contracts, cache, silentLog);
  const guard = new AdminGuard(env.TELEGRAM_ADMIN_IDS, repos.admins);
  const adminService = new AdminService({
    guard,
    repos,
    contracts,
    onContractChanged: async (a) => {
      await Promise.all([tokenSvc.invalidate(a), market.invalidate(a)]);
    },
  });
  const announcements = new AnnouncementService({ repos, tokenSvc, market, env, log: silentLog });
  const retryJobs = vi.fn().mockResolvedValue(true);
  const deps: BotDeps = {
    env,
    log: silentLog,
    repos,
    cache,
    guard,
    adminService,
    announcements,
    tokenSvc,
    contracts,
    market,
    bsc: { checkHealth: async () => [{ host: 'rpc.test', role: 'primary', ok: true, latencyMs: 5, lastBlock: 1, lastError: null, consecutiveFailures: 0, lastCheckedAt: 1 }], destroy: () => undefined } as unknown as BscProvider,
    jobs: { enqueueAnnounceRetry: retryJobs, running: 'timers' } as unknown as BackgroundJobs,
    dbPing: async () => true,
  };

  const bot = createBot(deps);
  bot.botInfo = { id: 999, is_bot: true, first_name: 'AGALIO', username: 'agalio_test_bot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as UserFromGetMe;

  const calls: ApiCall[] = [];
  const failures: Record<string, { error: { error_code: number; description: string; parameters?: { retry_after: number } }; left: number }> = {};
  let messageId = 5000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const f = failures[method];
    if (f && f.left > 0) {
      f.left -= 1;
      return { ok: false, ...f.error } as never;
    }
    if (method === 'sendMessage') return { ok: true, result: { message_id: ++messageId, date: 1, chat: { id: (payload as { chat_id: number }).chat_id, type: 'supergroup' } } } as never;
    if (method === 'sendPhoto') return { ok: true, result: { message_id: ++messageId, date: 1, chat: { id: 1, type: 'supergroup' }, photo: [{ file_id: 'LOGO_FILE_ID' }] } } as never;
    return { ok: true, result: true } as never;
  });

  const user = (id: number) => ({ id, is_bot: false, first_name: `U${id}` });
  const send = (update: Record<string, unknown>) => bot.handleUpdate({ update_id: updateCounter++, ...update } as never);

  return {
    db,
    deps,
    bot,
    calls,
    retryJobs,
    failNext: (method, error, times = 1) => {
      failures[method] = { error, left: times };
    },
    setMarket: (d) => {
      marketState = d;
    },
    setOnchain: (d) => {
      onchainState = d;
    },
    sent: () => calls.filter((c) => ['sendMessage', 'sendPhoto'].includes(c.method)),
    send,
    groupMessage: (text, id = 100, userId = MEMBER_ID) =>
      send({ message: { message_id: id, date: 1, chat: { id: GROUP_ID, type: 'supergroup', title: 'AGALIO NETWORK' }, from: user(userId), text } }),
    privateCommand: (cmd, args = '', userId = ADMIN_ID, extra = {}) => {
      const text = args ? `/${cmd} ${args}` : `/${cmd}`;
      return send({ message: { message_id: 1, date: 1, chat: { id: userId, type: 'private' }, from: user(userId), text, entities: [{ type: 'bot_command', offset: 0, length: cmd.length + 1 }], ...extra } });
    },
    callback: (data, userId = MEMBER_ID) =>
      send({ callback_query: { id: `cq${queryCounter++}`, from: user(userId), chat_instance: 'ci', data, message: { message_id: 6001, date: 1, chat: { id: GROUP_ID, type: 'supergroup' } } } }),
    privateText: (text, userId = ADMIN_ID) => send({ message: { message_id: 2, date: 1, chat: { id: userId, type: 'private' }, from: user(userId), text } }),
    privatePhoto: (userId = ADMIN_ID) => send({ message: { message_id: 3, date: 1, chat: { id: userId, type: 'private' }, from: user(userId), photo: [{ file_id: 'small', file_unique_id: 'a', width: 1, height: 1 }, { file_id: 'PHOTO_BIG', file_unique_id: 'b', width: 9, height: 9 }] } }),
    panelPress: (data, userId = ADMIN_ID) =>
      send({ callback_query: { id: `cq${queryCounter++}`, from: user(userId), chat_instance: 'ci', data, message: { message_id: 7001, date: 1, chat: { id: userId, type: 'private' } } } }),
    last: (method) => [...calls].reverse().find((c) => c.method === method),
    close: async () => {
      await db.$disconnect();
    },
  };
}
