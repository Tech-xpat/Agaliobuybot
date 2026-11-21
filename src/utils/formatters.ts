import { formatUnits } from 'ethers';
import { UNAVAILABLE } from '../config/constants';

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format a raw on-chain supply using decimals, with BigInt-safe arithmetic. */
export function formatSupply(raw: string | bigint | null | undefined, decimals: number | null | undefined): string {
  if (raw === null || raw === undefined || decimals === null || decimals === undefined) return UNAVAILABLE;
  try {
    const text = formatUnits(BigInt(raw), decimals);
    const [i, f] = text.split('.');
    const frac = f && f !== '0' ? `.${f.slice(0, 4)}` : '';
    return `${group(i ?? '0')}${frac}`;
  } catch {
    return UNAVAILABLE;
  }
}

export function formatUsdCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return UNAVAILABLE;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatUsdPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return UNAVAILABLE;
  if (n >= 1) return `$${n.toFixed(n >= 100 ? 2 : 4)}`;
  const decimals = Math.min(12, Math.max(4, 2 - Math.floor(Math.log10(n)) + 2));
  return `$${n.toFixed(decimals)}`;
}

export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return UNAVAILABLE;
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function formatDate(input: Date | string | number | null | undefined): string {
  if (input === null || input === undefined || input === '') return UNAVAILABLE;
  // Accept ISO strings / timestamps too: values that went through a JSON cache are no longer Dates.
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return UNAVAILABLE;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function redactUrl(raw: string | undefined | null): string {
  if (!raw) return 'not set';
  try {
    return new URL(raw).host;
  } catch {
    return 'invalid';
  }
}

/** Human-friendly token/coin amount from raw units: 1,234.56 for big values, 0.000123 for tiny ones. */
export function formatAmount(raw: bigint, decimals: number): string {
  try {
    const [i = '0', f = ''] = formatUnits(raw, decimals).split('.');
    if (i === '0') {
      const frac = f.slice(0, 6).replace(/0+$/, '');
      return frac ? `0.${frac}` : f ? '<0.000001' : '0';
    }
    const frac = f.slice(0, 2).replace(/0+$/, '');
    return `${group(i)}${frac ? `.${frac}` : ''}`;
  } catch {
    return UNAVAILABLE;
  }
}
