import { isIP } from 'node:net';
import { ValidationError } from '../utils/errors';

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const MAX_URL_LENGTH = 1000;

function isPrivateIp(host: string): boolean {
  const kind = isIP(host);
  if (kind === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  return false;
}

/**
 * Validates an external URL before it is published in a button.
 * Only https, no credentials, no local/private hosts, no whitespace.
 */
export function validateExternalUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new ValidationError('URL is empty.');
  if (value.length > MAX_URL_LENGTH) throw new ValidationError('URL is too long.');
  if (/\s/.test(value)) throw new ValidationError('URL must not contain spaces.');
  // Allow {contract} placeholders: swap them for a safe token while parsing.
  const probe = value.replace(/\{contract\}/g, '0x0000000000000000000000000000000000000001');
  let url: URL;
  try {
    url = new URL(probe);
  } catch {
    throw new ValidationError('That is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Only https:// URLs are allowed.');
  if (url.username || url.password) throw new ValidationError('URLs with embedded credentials are not allowed.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal') || isPrivateIp(host)) {
    throw new ValidationError('Local or private hosts are not allowed.');
  }
  if (!host.includes('.') && !isIP(host)) throw new ValidationError('URL must use a public domain name.');
  return value;
}

/** Same as validate, but returns null instead of throwing (used at render time). */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return validateExternalUrl(raw);
  } catch {
    return null;
  }
}

export function renderUrlTemplate(template: string, vars: { contract: string }): string {
  return template.replace(/\{contract\}/g, vars.contract);
}

export function bscscanTokenUrl(baseUrl: string, address: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/token/${address}`;
}
