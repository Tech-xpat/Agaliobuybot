import pino, { Logger } from 'pino';

const SENSITIVE_KEY = /token|secret|password|authorization|api[_-]?key|private|seed|mnemonic|database_url|redis_url/i;
const URL_SECRET = /([?&](?:api[_-]?key|key|token|secret)=)[^&\s"']+/gi;
const BOT_TOKEN_RE = /(?<![0-9])\d{6,12}:[A-Za-z0-9_-]{30,}/g;

export function scrubString(input: string, extraSecrets: string[] = []): string {
  let out = input.replace(BOT_TOKEN_RE, '[REDACTED_BOT_TOKEN]').replace(URL_SECRET, '$1[REDACTED]');
  for (const s of extraSecrets) if (s && s.length > 6) out = out.split(s).join('[REDACTED]');
  return out;
}

export function scrubValue(value: unknown, secrets: string[], depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value, secrets);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object' || depth > 5) return value;
  if (value instanceof Error) {
    return { type: value.name, message: scrubString(value.message, secrets), stack: scrubString(value.stack ?? '', secrets) };
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, secrets, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : scrubValue(v, secrets, depth + 1);
  }
  return out;
}

export function createLogger(level: string, secrets: string[] = [], destination?: pino.DestinationStream): Logger {
  return pino(
    {
      level,
      base: { app: 'agalio-buybot' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        log: (obj) => scrubValue(obj, secrets) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          const mapped = args.map((a) => (typeof a === 'string' ? scrubString(a, secrets) : a));
          return method.apply(this, mapped as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
}

export type { Logger };
