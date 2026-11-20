import { FetchRequest, JsonRpcProvider, Network } from 'ethers';
import type { Logger } from 'pino';
import { BSC_CHAIN_ID } from '../config/constants';
import { ExternalServiceError, errMessage } from '../utils/errors';
import { redactUrl } from '../utils/formatters';

export interface EndpointHealth {
  host: string;
  role: 'primary' | 'fallback';
  ok: boolean | null;
  latencyMs: number | null;
  lastBlock: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastCheckedAt: number | null;
}

interface Endpoint {
  url: string;
  provider: JsonRpcProvider;
  health: EndpointHealth;
  cooldownUntil: number;
}

export interface BscProviderOptions {
  urls: string[];
  timeoutMs: number;
  maxRetries: number;
  /** Override for tests. */
  providerFactory?: (url: string, timeoutMs: number) => JsonRpcProvider;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRateLimit(err: unknown): boolean {
  const m = errMessage(err).toLowerCase();
  const code = (err as { code?: string | number; status?: number })?.code;
  const status = (err as { status?: number })?.status;
  return m.includes('429') || m.includes('rate limit') || m.includes('too many requests') || code === 429 || status === 429;
}

function isDeterministic(err: unknown): boolean {
  // Contract reverts / bad data will not improve by retrying another RPC.
  const code = (err as { code?: string })?.code;
  return code === 'CALL_EXCEPTION' || code === 'BAD_DATA' || code === 'INVALID_ARGUMENT';
}

function defaultFactory(url: string, timeoutMs: number): JsonRpcProvider {
  const req = new FetchRequest(url);
  req.timeout = timeoutMs;
  return new JsonRpcProvider(req, BSC_CHAIN_ID, {
    staticNetwork: Network.from(BSC_CHAIN_ID),
    batchMaxCount: 1,
  });
}

/**
 * Primary + fallback BSC JSON-RPC access with retries, backoff, rate-limit
 * handling and health tracking. RPC failures surface as ExternalServiceError
 * and never throw out of a background job.
 */
export class BscProvider {
  private endpoints: Endpoint[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly opts: BscProviderOptions,
    private readonly log: Logger,
  ) {
    const factory = opts.providerFactory ?? defaultFactory;
    this.sleep = opts.sleep ?? defaultSleep;
    this.endpoints = opts.urls.map((url, i) => ({
      url,
      provider: factory(url, opts.timeoutMs),
      cooldownUntil: 0,
      health: {
        host: redactUrl(url),
        role: i === 0 ? 'primary' : 'fallback',
        ok: null,
        latencyMs: null,
        lastBlock: null,
        lastError: null,
        consecutiveFailures: 0,
        lastCheckedAt: null,
      },
    }));
    if (this.endpoints.length === 0) throw new Error('At least one BSC RPC URL is required');
  }

  /** Run `fn` against the healthiest endpoint, failing over and retrying with backoff. */
  async call<T>(label: string, fn: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
    const attempts = this.opts.maxRetries + 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const ordered = this.orderedEndpoints();
      for (const ep of ordered) {
        const started = Date.now();
        try {
          const result = await fn(ep.provider);
          this.markOk(ep, Date.now() - started);
          return result;
        } catch (err) {
          lastErr = err;
          if (isDeterministic(err)) throw err;
          this.markFail(ep, err);
          if (isRateLimit(err)) ep.cooldownUntil = Date.now() + 15_000;
        }
      }
      if (attempt < attempts - 1) {
        const backoff = Math.min(4000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
        await this.sleep(backoff);
      }
    }
    this.log.warn({ label, err: lastErr }, 'BSC RPC call failed on all endpoints');
    throw new ExternalServiceError(`BSC RPC call failed (${label}): ${errMessage(lastErr)}`, 'bsc-rpc');
  }

  private orderedEndpoints(): Endpoint[] {
    const now = Date.now();
    return [...this.endpoints].sort((a, b) => {
      const ac = a.cooldownUntil > now ? 1 : 0;
      const bc = b.cooldownUntil > now ? 1 : 0;
      if (ac !== bc) return ac - bc;
      if (a.health.consecutiveFailures !== b.health.consecutiveFailures) {
        return a.health.consecutiveFailures - b.health.consecutiveFailures;
      }
      return this.endpoints.indexOf(a) - this.endpoints.indexOf(b);
    });
  }

  private markOk(ep: Endpoint, latency: number): void {
    ep.health.ok = true;
    ep.health.latencyMs = latency;
    ep.health.consecutiveFailures = 0;
    ep.health.lastError = null;
    ep.health.lastCheckedAt = Date.now();
  }

  private markFail(ep: Endpoint, err: unknown): void {
    ep.health.ok = false;
    ep.health.consecutiveFailures += 1;
    ep.health.lastError = errMessage(err).slice(0, 200);
    ep.health.lastCheckedAt = Date.now();
  }

  /** Probe each endpoint directly (used by /status and the health monitor). */
  async checkHealth(): Promise<EndpointHealth[]> {
    await Promise.all(
      this.endpoints.map(async (ep) => {
        const started = Date.now();
        try {
          const block = await ep.provider.getBlockNumber();
          this.markOk(ep, Date.now() - started);
          ep.health.lastBlock = block;
        } catch (err) {
          this.markFail(ep, err);
        }
      }),
    );
    return this.getHealth();
  }

  getHealth(): EndpointHealth[] {
    return this.endpoints.map((e) => ({ ...e.health }));
  }

  destroy(): void {
    for (const e of this.endpoints) e.provider.destroy();
  }
}
