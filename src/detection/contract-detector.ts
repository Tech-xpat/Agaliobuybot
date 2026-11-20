import { extractAddresses, type NormalizedAddress } from '../blockchain/address.validator';

export interface DetectionResult {
  /** every valid address found in the text */
  found: NormalizedAddress[];
  /** malformed candidates (bad checksum etc.), never announced */
  invalid: string[];
  /** true only if the exact configured official contract is present */
  officialMatched: boolean;
  /** the official contract (checksum) when matched */
  matched: NormalizedAddress | null;
}

/**
 * Pure detection. A match requires the address to be valid AND equal (case-insensitive)
 * to the configured official contract. Who posted it, or whether it was forwarded,
 * is irrelevant to authenticity: the match is against the admin-configured address only.
 */
export function detectContract(text: string, officialLower: string | null): DetectionResult {
  const { valid, invalid } = extractAddresses(text);
  const matched = officialLower ? (valid.find((a) => a.lower === officialLower.toLowerCase()) ?? null) : null;
  return { found: valid, invalid, officialMatched: matched !== null, matched };
}
