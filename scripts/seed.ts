/* Seeds default token/config rows from the environment. Safe to run repeatedly. */
import 'dotenv/config';
import { loadEnv } from '../src/config/env';
import { createPrisma } from '../src/database/prisma';
import { createRepositories } from '../src/database/repositories';

async function main() {
  const env = loadEnv();
  const db = createPrisma(env.DATABASE_URL);
  const repos = createRepositories(db);
  await repos.config.ensure(env);
  const { token, contract } = await repos.tokens.ensureSeeded(env);
  await repos.groups.ensure(BigInt(env.TELEGRAM_GROUP_ID));
  console.log(`Seeded token ${token.name} (${token.symbol}); official contract: ${contract?.checksum ?? 'not set'}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
