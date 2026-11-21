import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { errMessage } from '../utils/errors';
import { createQueueRedis } from './redis';
import { JOB, QUEUE_NAME, type AnnounceRetryData, type JobHandlers } from './jobs';

export interface BackgroundJobsOptions {
  redisUrl: string;
  refreshSeconds: number;
  /** Interval of the buy-alert scan. Leave undefined to disable it. */
  buyScanSeconds?: number;
  prefix?: string;
}

/**
 * BullMQ-backed background work: market refresh, buy-alert scans, RPC health, pruning, announcement retries.
 * Schedulers and delayed jobs live in Redis, so they survive restarts. If Redis cannot be
 * reached at startup the bot falls back to in-process timers (retries are then best-effort).
 */
export class BackgroundJobs {
  private queue?: Queue;
  private worker?: Worker;
  private connections: Redis[] = [];
  private timers: NodeJS.Timeout[] = [];
  private mode: 'bullmq' | 'timers' | 'stopped' = 'stopped';

  constructor(
    private readonly opts: BackgroundJobsOptions,
    private readonly handlers: JobHandlers,
    private readonly log: Logger,
  ) {}

  get running(): 'bullmq' | 'timers' | 'stopped' {
    return this.mode;
  }

  async start(): Promise<void> {
    try {
      await this.startBull();
      this.mode = 'bullmq';
      this.log.info('Background jobs running on BullMQ');
    } catch (err) {
      this.log.warn({ err: errMessage(err) }, 'BullMQ unavailable, falling back to in-process timers');
      await this.teardownBull();
      this.startTimers();
      this.mode = 'timers';
    }
  }

  private async startBull(): Promise<void> {
    const prefix = this.opts.prefix ?? 'agalio-bull';
    const qConn = createQueueRedis(this.opts.redisUrl, this.log);
    const wConn = createQueueRedis(this.opts.redisUrl, this.log);
    this.connections.push(qConn, wConn);

    // Fail fast if Redis is unreachable.
    await Promise.race([
      qConn.ping(),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('Redis ping timeout')), 5000)),
    ]);

    this.queue = new Queue(QUEUE_NAME, { connection: qConn, prefix });
    this.queue.on('error', (e) => this.log.debug({ err: e.message }, 'Queue error'));
    this.worker = new Worker(QUEUE_NAME, (job) => this.process(job), { connection: wConn, prefix, concurrency: 1 });
    this.worker.on('error', (e) => this.log.warn({ err: e.message }, 'Worker error'));
    this.worker.on('failed', (job, e) => this.log.warn({ job: job?.name, err: e.message }, 'Job failed'));

    const every = (seconds: number) => ({ every: seconds * 1000 });
    const opts = { removeOnComplete: 20, removeOnFail: 50 };
    await this.queue.upsertJobScheduler(JOB.MARKET_REFRESH, every(this.opts.refreshSeconds), { name: JOB.MARKET_REFRESH, opts });
    await this.queue.upsertJobScheduler(JOB.RPC_HEALTH, every(300), { name: JOB.RPC_HEALTH, opts });
    await this.queue.upsertJobScheduler(JOB.PRUNE, every(86_400), { name: JOB.PRUNE, opts });
    if (this.opts.buyScanSeconds && this.handlers.scanBuys) {
      await this.queue.upsertJobScheduler(JOB.BUY_SCAN, every(this.opts.buyScanSeconds), { name: JOB.BUY_SCAN, opts: { removeOnComplete: 5, removeOnFail: 20 } });
    } else {
      // Buy alerts switched off: drop a scheduler left over from an earlier run.
      await this.queue.removeJobScheduler(JOB.BUY_SCAN).catch(() => undefined);
    }
  }

  private async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB.MARKET_REFRESH:
        return this.safe('market-refresh', () => this.handlers.refreshMarket());
      case JOB.RPC_HEALTH:
        return this.safe('rpc-health', () => this.handlers.checkRpc());
      case JOB.PRUNE:
        return this.safe('prune', () => this.handlers.prune());
      case JOB.BUY_SCAN:
        return this.safe('buy-scan', async () => void (await this.handlers.scanBuys?.()));
      case JOB.ANNOUNCE_RETRY:
        // Throw on failure so BullMQ applies its retry/backoff policy.
        return this.handlers.retryAnnouncement(job.data as AnnounceRetryData);
      default:
        this.log.warn({ name: job.name }, 'Unknown job');
    }
  }

  private async safe(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log.warn({ err: errMessage(err), job: name }, 'Scheduled job failed (will run again on schedule)');
    }
  }

  private startTimers(): void {
    const run = (name: string, fn: () => Promise<void>, ms: number) => {
      const t = setInterval(() => void this.safe(name, fn), ms);
      t.unref();
      this.timers.push(t);
    };
    run('market-refresh', () => this.handlers.refreshMarket(), this.opts.refreshSeconds * 1000);
    run('rpc-health', () => this.handlers.checkRpc(), 300_000);
    run('prune', () => this.handlers.prune(), 86_400_000);
    const scanBuys = this.handlers.scanBuys;
    if (this.opts.buyScanSeconds && scanBuys) run('buy-scan', () => scanBuys(), this.opts.buyScanSeconds * 1000);
  }

  /** Schedules a retry of a failed announcement. Returns false if it could not be queued. */
  async enqueueAnnounceRetry(data: AnnounceRetryData, delayMs: number): Promise<boolean> {
    const jobId = `retry-${data.chatId}-${data.replyTo ?? 'none'}-${data.kind}`;
    try {
      if (this.queue && this.mode === 'bullmq') {
        await this.queue.add(JOB.ANNOUNCE_RETRY, data, {
          jobId,
          delay: Math.max(0, delayMs),
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 20,
          removeOnFail: 50,
        });
        return true;
      }
      const t = setTimeout(() => void this.handlers.retryAnnouncement(data).catch((e) => this.log.warn({ err: errMessage(e) }, 'Retry failed')), delayMs);
      t.unref();
      this.timers.push(t);
      return true;
    } catch (err) {
      this.log.warn({ err: errMessage(err) }, 'Could not queue announcement retry');
      return false;
    }
  }

  private async teardownBull(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    for (const c of this.connections) c.disconnect();
    this.connections = [];
    this.worker = undefined;
    this.queue = undefined;
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.teardownBull();
    this.mode = 'stopped';
  }
}
