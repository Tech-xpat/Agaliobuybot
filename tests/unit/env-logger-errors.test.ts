import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createLogger, scrubString } from '../../src/services/logger.service';
import { AuthorizationError, ValidationError, isTelegramMessageGone, telegramRetryAfter, toUserMessage } from '../../src/utils/errors';
import { formatSupply, formatUsdPrice } from '../../src/utils/formatters';
import { splitMessage } from '../../src/utils/sanitizers';
import { BOT_TOKEN, testEnv } from '../fixtures';

describe('environment validation', () => {
  it('loads a valid configuration', () => {
    const env = testEnv();
    expect(env.BSC_CHAIN_ID).toBe(56);
    expect(env.TELEGRAM_ADMIN_IDS).toEqual([1001n]);
    expect(env.BOT_MODE).toBe('polling');
  });

  it('fails loudly on missing required values (no silent defaults for secrets)', () => {
    expect(() => loadEnv({})).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadEnv({ ...process.env, TELEGRAM_BOT_TOKEN: '' })).toThrow();
  });

  it('rejects a wrong chain id, bad admin ids and a bad contract', () => {
    expect(() => testEnv({ BSC_CHAIN_ID: '1' })).toThrow(/56/);
    expect(() => testEnv({ TELEGRAM_ADMIN_IDS: 'alice' })).toThrow(/admin/i);
    expect(() => testEnv({ AGALIO_CONTRACT_ADDRESS: '0x123' })).toThrow();
  });

  it('requires https URL and secret in webhook mode', () => {
    expect(() => testEnv({ BOT_MODE: 'webhook' })).toThrow(/WEBHOOK/);
    expect(testEnv({ BOT_MODE: 'webhook', WEBHOOK_URL: 'https://bot.example.com', WEBHOOK_SECRET: 'a'.repeat(32) }).BOT_MODE).toBe('webhook');
  });

  it('treats empty optional values as unset', () => {
    expect(testEnv({ AGALIO_BUY_URL: '', AGALIO_CONTRACT_ADDRESS: '' }).AGALIO_BUY_URL).toBeUndefined();
  });
});

describe('logging and error safety', () => {
  it('redacts the bot token and URL secrets from log output', () => {
    expect(scrubString(`failed https://api.telegram.org/bot${BOT_TOKEN}/getMe`)).not.toContain(BOT_TOKEN);
    expect(scrubString('https://rpc.example/v1?apikey=SUPERSECRET123')).not.toContain('SUPERSECRET123');
  });

  it('redacts sensitive keys in structured logs', () => {
    const lines: string[] = [];
    const log = createLogger('info', [BOT_TOKEN], { write: (s: string) => void lines.push(s) });
    log.info({ TELEGRAM_BOT_TOKEN: BOT_TOKEN, password: 'x', nested: { apiKey: 'k', note: `token ${BOT_TOKEN}` } }, 'hello');
    expect(lines.join('')).not.toContain(BOT_TOKEN);
    expect(lines.join('')).toContain('[REDACTED');
  });

  it('only exposes user-safe error messages to Telegram', () => {
    expect(toUserMessage(new ValidationError('Bad URL'))).toBe('Bad URL');
    expect(toUserMessage(new AuthorizationError())).toMatch(/not authorized/i);
    expect(toUserMessage(new Error('connect ECONNREFUSED 10.0.0.1:5432 password=hunter2'))).not.toContain('hunter2');
  });

  it('recognises Telegram expiry/rate-limit errors', () => {
    expect(isTelegramMessageGone(new Error('Bad Request: query is too old and response timeout expired'))).toBe(true);
    expect(isTelegramMessageGone(new Error('something else'))).toBe(false);
    expect(telegramRetryAfter({ error_code: 429, parameters: { retry_after: 7 } })).toBe(7);
    expect(telegramRetryAfter({ error_code: 400 })).toBeUndefined();
  });
});

describe('formatters', () => {
  it('formats supply with decimals without precision loss', () => {
    expect(formatSupply('1000000000000000000000000000', 18)).toBe('1,000,000,000');
    expect(formatSupply('123456789', 2)).toBe('1,234,567.89');
    expect(formatSupply(null, 18)).toMatch(/unavailable/);
  });
  it('never renders zero or negative prices as data', () => {
    expect(formatUsdPrice(0)).toMatch(/unavailable/);
    expect(formatUsdPrice(null)).toMatch(/unavailable/);
  });
  it('splits long messages under the limit', () => {
    const parts = splitMessage(Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n'), 400);
    expect(parts.every((p) => p.length <= 400)).toBe(true);
    expect(parts.length).toBeGreaterThan(1);
  });
});
