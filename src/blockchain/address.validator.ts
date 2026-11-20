import { getAddress, isAddress } from 'ethers';
import { stripInvisible } from '../utils/sanitizers';

export interface NormalizedAddress {
  /** lowercase, for comparison and storage */
  lower: string;
  /** EIP-55 checksummed, for display */
  checksum: string;
}

const CANDIDATE = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-zA-Z])/g;
const ZERO = /^0x0{40}$/i;

/**
 * Validates a BSC/EVM address. All-lowercase and all-uppercase hex are accepted;
 * mixed-case input must carry a correct EIP-55 checksum.
 */
export function normalizeAddress(input: string): NormalizedAddress | null {
  const value = stripInvisible(input).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  if (ZERO.test(value)) return null;
  if (!isAddress(value)) return null;
  const checksum = getAddress(value.toLowerCase());
  return { lower: checksum.toLowerCase(), checksum };
}

export interface ExtractedAddresses {
  valid: NormalizedAddress[];
  invalid: string[];
}

/** Finds every 0x + 40-hex candidate in free text and validates each. */
export function extractAddresses(text: string): ExtractedAddresses {
  const cleaned = stripInvisible(text);
  const seen = new Set<string>();
  const valid: NormalizedAddress[] = [];
  const invalid: string[] = [];
  for (const match of cleaned.matchAll(CANDIDATE)) {
    const raw = match[0];
    const n = normalizeAddress(raw);
    if (n) {
      if (!seen.has(n.lower)) {
        seen.add(n.lower);
        valid.push(n);
      }
    } else if (!invalid.includes(raw)) {
      invalid.push(raw);
    }
  }
  return { valid, invalid };
}
