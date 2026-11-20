import { describe, expect, it } from 'vitest';
import { extractAddresses, normalizeAddress } from '../../src/blockchain/address.validator';
import { detectContract } from '../../src/detection/contract-detector';
import { OFFICIAL, OTHER } from '../fixtures';

describe('address validation', () => {
  it('accepts a valid checksummed BSC address and normalizes it', () => {
    const n = normalizeAddress(OFFICIAL);
    expect(n?.checksum).toBe(OFFICIAL);
    expect(n?.lower).toBe(OFFICIAL.toLowerCase());
  });

  it('accepts all-lowercase and all-uppercase hex', () => {
    expect(normalizeAddress(OFFICIAL.toLowerCase())?.checksum).toBe(OFFICIAL);
    expect(normalizeAddress('0x' + OFFICIAL.slice(2).toUpperCase())?.checksum).toBe(OFFICIAL);
  });

  it('rejects invalid addresses', () => {
    expect(normalizeAddress('0x1234')).toBeNull();
    expect(normalizeAddress('0x' + 'g'.repeat(40))).toBeNull();
    expect(normalizeAddress('1234567890abcdef1234567890abcdef12345678')).toBeNull();
    expect(normalizeAddress('0x' + '0'.repeat(40))).toBeNull(); // zero address
  });

  it('rejects mixed-case addresses with a wrong checksum', () => {
    const idx = [...OFFICIAL.slice(2)].findIndex((c) => /[a-fA-F]/.test(c)) + 2;
    const ch = OFFICIAL[idx]!;
    const flipped = OFFICIAL.slice(0, idx) + (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) + OFFICIAL.slice(idx + 1);
    expect(flipped).not.toBe(OFFICIAL);
    expect(normalizeAddress(flipped)).toBeNull();
  });

  it('extracts addresses inside ordinary text, with emojis and the token name', () => {
    const text = `🚀🚀 AGALIO is live!!! CA: ${OFFICIAL} 🔥 buy now (not ${OTHER})`;
    const { valid } = extractAddresses(text);
    expect(valid.map((a) => a.checksum)).toEqual([OFFICIAL, OTHER]);
  });

  it('does not match a 40-hex string embedded in a longer hex run', () => {
    const { valid, invalid } = extractAddresses(`0x${'a'.repeat(64)}`);
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(0);
  });

  it('sees through zero-width character obfuscation', () => {
    const sneaky = OFFICIAL.slice(0, 10) + '\u200b' + OFFICIAL.slice(10);
    expect(extractAddresses(`ca ${sneaky}`).valid[0]?.checksum).toBe(OFFICIAL);
  });

  it('reports malformed candidates as invalid (never valid)', () => {
    const bad = '0x' + 'AbCdEf'.repeat(6) + 'aBcD';
    const res = extractAddresses(`look ${bad}`);
    expect(res.valid).toHaveLength(0);
    expect(res.invalid).toEqual([bad]);
  });
});

describe('contract detection', () => {
  const official = OFFICIAL.toLowerCase();

  it('matches the exact official contract (any casing)', () => {
    expect(detectContract(OFFICIAL, official).officialMatched).toBe(true);
    expect(detectContract(OFFICIAL.toLowerCase(), official).officialMatched).toBe(true);
    expect(detectContract(`CA: ${OFFICIAL}`, official).matched?.checksum).toBe(OFFICIAL);
  });

  it('ignores a random, valid but different contract', () => {
    const r = detectContract(`check this ${OTHER}`, official);
    expect(r.found).toHaveLength(1);
    expect(r.officialMatched).toBe(false);
  });

  it('matches when the official contract appears alongside other contracts', () => {
    expect(detectContract(`${OTHER} vs ${OFFICIAL}`, official).officialMatched).toBe(true);
  });

  it('never matches when no official contract is configured', () => {
    expect(detectContract(OFFICIAL, null).officialMatched).toBe(false);
  });

  it('does not match a lookalike with one character changed', () => {
    const lookalike = OFFICIAL.slice(0, -1) + (OFFICIAL.endsWith('8') ? '9' : '8');
    expect(detectContract(lookalike.toLowerCase(), official).officialMatched).toBe(false);
  });
});
