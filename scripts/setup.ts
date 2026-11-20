/* Interactive-free launch-readiness check: validates env and external connectivity. */
import 'dotenv/config';
import { loadEnv } from '../src/config/env';
import { createLogger } from '../src/services/logger.service';
import { BscProvider } from '../src/blockchain/bsc.provider';
import { createPrisma } from '../src/database/prisma';

async function main() {
  const env = loadEnv();
  const log = createLogger('error', [env.TELEGRAM_BOT_TOKEN]);
  console.log('✔ Environment variables are valid');

  const db = createPrisma(env.DATABASE_URL);
  await db.$queryRaw`SELECT 1`;
  console.log('✔ Database reachable');
  await db.$disconnect();

  const bsc = new BscProvider({ urls: [env.BSC_RPC_URL, ...(env.BSC_FALLBACK_RPC_URL ? [env.BSC_FALLBACK_RPC_URL] : [])], timeoutMs: env.RPC_TIMEOUT_MS, maxRetries: 0 }, log);
  for (const h of await bsc.checkHealth()) {
    console.log(`${h.ok ? '✔' : '✖'} BSC RPC ${h.role} ${h.host}${h.ok ? ` (block ${h.lastBlock}, ${h.latencyMs}ms)` : ` – ${h.lastError}`}`);
  }
  bsc.destroy();

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
  const body = (await res.json()) as { ok: boolean; result?: { username: string; can_read_all_group_messages?: boolean } };
  if (!body.ok) throw new Error('Telegram rejected the bot token');
  console.log(`✔ Telegram bot @${body.result?.username}`);
  console.log(
    body.result?.can_read_all_group_messages
      ? '✔ Privacy mode is OFF (bot can read all group messages)'
      : '⚠ Privacy mode is ON. Disable it in BotFather (/setprivacy → Disable), then remove and re-add the bot to the group.',
  );
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
