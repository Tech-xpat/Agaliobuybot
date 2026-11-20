import { createServer, type Server } from 'node:http';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import { AdminGuard } from './admin/admin.guard';
import { AdminService } from './admin/admin.service';
import { AnnouncementService } from './announcements/announcement.service';
import { BscProvider } from './blockchain/bsc.provider';
import { ContractService } from './blockchain/contract.service';
import { TokenService } from './blockchain/token.service';
import { ALLOWED_UPDATES, createBot } from './bot/bot';
import type { BotDeps } from './bot/context';
import type { Env } from './config/env';
import { createPrisma } from './database/prisma';
import { createRepositories } from './database/repositories';
import { DexScreenerProvider } from './market-data/dexscreener.provider';
import { MarketService } from './market-data/market.service';
import type { JobHandlers } from './queue/jobs';
import { createCacheRedis, toRedisLike } from './queue/redis';
import { BackgroundJobs } from './queue/workers';
import { CacheService } from './services/cache.service';
import { createLogger } from './services/logger.service';
import { errMessage } from './utils/errors';

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  bot: Bot;
  log: Logger;
}

const WEBHOOK_PATH = '/telegram/webhook';

export async function createApp(env: Env): Promise<App> {
  const log = createLogger(env.LOG_LEVEL, [env.TELEGRAM_BOT_TOKEN, env.BSC_RPC_URL, env.BSC_FALLBACK_RPC_URL ?? '', env.WEBHOOK_SECRET ?? '']);

  // --- infrastructure -------------------------------------------------------
  const db = createPrisma(env.DATABASE_URL);
  await db.$connect();
  const redis = createCacheRedis(env.REDIS_URL, log);
  await redis.connect().catch((err) => log.warn({ err: errMessage(err) }, 'Redis not reachable at startup, using in-memory fallback until it returns'));
  const cache = new CacheService(toRedisLike(redis), log);
  const repos = createRepositories(db);

  // --- seed configuration (DB is the source of truth after first run) ------------
  await repos.config.ensure(env);
  await repos.tokens.ensureSeeded(env);
  await repos.groups.ensure(BigInt(env.TELEGRAM_GROUP_ID));

  // --- domain services ---------------------------------------------------------
  const bsc = new BscProvider(
    {
      urls: [env.BSC_RPC_URL, ...(env.BSC_FALLBACK_RPC_URL ? [env.BSC_FALLBACK_RPC_URL] : [])],
      timeoutMs: env.RPC_TIMEOUT_MS,
      maxRetries: env.RPC_MAX_RETRIES,
    },
    log,
  );
  const contracts = new ContractService(bsc);
  const tokenSvc = new TokenService(contracts, cache, log);
  const market = new MarketService(
    [new DexScreenerProvider({ baseUrl: env.DEXSCREENER_API_BASE_URL, timeoutMs: env.MARKET_TIMEOUT_MS, maxRetries: env.MARKET_MAX_RETRIES }, log)],
    cache,
    log,
    { refreshSeconds: env.MARKET_REFRESH_SECONDS },
  );
  const guard = new AdminGuard(env.TELEGRAM_ADMIN_IDS, repos.admins);
  const adminService = new AdminService({
    guard,
    repos,
    contracts,
    onContractChanged: async (address) => {
      await Promise.all([tokenSvc.invalidate(address), market.invalidate(address)]);
    },
  });
  const announcements = new AnnouncementService({ repos, tokenSvc, market, env, log });

  // --- background jobs ---------------------------------------------------------
  const ref: { bot?: Bot } = {};
  const handlers: JobHandlers = {
    async refreshMarket() {
      const official = await repos.tokens.getOfficial();
      if (!official?.contract) return;
      const result = await market.get(official.contract.checksum, { force: true });
      if (result.status === 'ok' && result.data && !result.stale) await repos.market.save(official.token.id, result.data);
    },
    async checkRpc() {
      const health = await bsc.checkHealth();
      if (health.every((h) => !h.ok)) await repos.audit.event('error', 'rpc.down', 'All BSC RPC endpoints are failing');
    },
    async prune() {
      const n = await repos.market.prune(14);
      log.info({ deleted: n }, 'Pruned old market snapshots');
    },
    async retryAnnouncement(data) {
      if (!ref.bot) throw new Error('Bot not ready');
      const res = await announcements.publish(ref.bot.api, { chatId: data.chatId, chatIdBig: BigInt(data.chatId), replyTo: data.replyTo, kind: data.kind });
      log.info({ ok: !!res }, 'Announcement retry processed');
    },
  };
  const jobs = new BackgroundJobs({ redisUrl: env.REDIS_URL, refreshSeconds: env.MARKET_REFRESH_SECONDS }, handlers, log);

  const deps: BotDeps = {
    env,
    log,
    repos,
    cache,
    guard,
    adminService,
    announcements,
    tokenSvc,
    contracts,
    market,
    bsc,
    jobs,
    dbPing: async () => {
      try {
        await db.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
  const bot = createBot(deps);
  ref.bot = bot;

  // --- HTTP: health always, webhook only in webhook mode -------------------------------
  const handleWebhook = env.BOT_MODE === 'webhook' ? webhookCallback(bot, 'http', { secretToken: env.WEBHOOK_SECRET }) : null;
  const server: Server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && (url === '/healthz' || url === '/readyz')) {
      void deps.dbPing().then((dbOk) => {
        res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: dbOk ? 'ok' : 'degraded', db: dbOk, mode: env.BOT_MODE }));
      });
      return;
    }
    if (handleWebhook && req.method === 'POST' && url === WEBHOOK_PATH) {
      void Promise.resolve(handleWebhook(req, res)).catch((err) => {
        log.error({ err: errMessage(err) }, 'Webhook handler error');
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  let stopping = false;

  return {
    bot,
    log,
    async start() {
      await new Promise<void>((resolve) => server.listen(env.PORT, '0.0.0.0', resolve));
      log.info({ port: env.PORT, mode: env.BOT_MODE }, 'HTTP server listening');
      await bot.init();
      log.info({ username: bot.botInfo.username }, 'Bot identity verified');
      await jobs.start();

      if (env.BOT_MODE === 'webhook') {
        // Webhook mode: never run polling at the same time.
        await bot.api.setWebhook(`${env.WEBHOOK_URL!.replace(/\/+$/, '')}${WEBHOOK_PATH}`, {
          secret_token: env.WEBHOOK_SECRET,
          allowed_updates: [...ALLOWED_UPDATES],
        });
        log.info('Webhook registered');
      } else {
        // Polling mode: make sure no webhook is registered, otherwise Telegram refuses getUpdates.
        await bot.api.deleteWebhook({ drop_pending_updates: false });
        void bot
          .start({ allowed_updates: [...ALLOWED_UPDATES], onStart: () => log.info('Long polling started') })
          .catch((err) => {
            if (!stopping) log.fatal({ err: errMessage(err) }, 'Polling stopped unexpectedly');
          });
      }
    },
    async stop() {
      if (stopping) return;
      stopping = true;
      log.info('Shutting down…');
      if (env.BOT_MODE === 'polling') await bot.stop().catch(() => undefined);
      await jobs.stop().catch(() => undefined);
      await new Promise<void>((r) => server.close(() => r()));
      bsc.destroy();
      await redis.quit().catch(() => undefined);
      await db.$disconnect().catch(() => undefined);
    },
  };
}
