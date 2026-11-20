import { createApp } from './app';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const app = await createApp(env);
  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'Signal received');
    void app.stop().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => app.log.error({ err: reason }, 'Unhandled promise rejection'));
  process.on('uncaughtException', (err) => app.log.fatal({ err }, 'Uncaught exception'));

  await app.start();
}

main().catch((err) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
