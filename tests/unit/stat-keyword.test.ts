import { describe, expect, it } from 'vitest';
import { buildStatReply } from '../../src/announcements/stat-reply';
import { buildContractOnlyHtml } from '../../src/announcements/announcement.builder';
import { detectStatRequest } from '../../src/detection/stat-keyword-detector';
import { marketDown, marketNoPair, marketOk, OFFICIAL, onchain } from '../fixtures';

describe('stat keyword detection', () => {
  it.each([
    ['price', ['price']],
    ['Price?', ['price']],
    ["what's the price", ['price']],
    ['price pls', ['price']],
    ['$agalio price', ['price']],
    ['how much is agalio', ['price']],
    ['mc', ['marketcap']],
    ['MC?', ['marketcap']],
    ['mcap', ['marketcap']],
    ['market cap', ['marketcap']],
    ["what's the market cap?", ['marketcap']],
    ['liquidity', ['liquidity']],
    ['liq?', ['liquidity']],
    ['volume', ['volume']],
    ['24h volume', ['volume']],
    ['holders', ['holders']],
    ['how many holders', ['holders']],
    ['supply', ['supply']],
    ['total supply?', ['supply']],
    ['decimals', ['decimals']],
    ['fdv', ['fdv']],
    ['price and mc', ['price', 'marketcap']],
    ['🚀 price 🚀', ['price']],
  ])('"%s" → %j', (text, topics) => {
    expect(detectStatRequest(text)).toEqual(topics);
  });

  it.each([
    'price is dumping',
    'the volume was crazy',
    'my mc target is 10m',
    'what is the price of bitcoin',
    'holders are strong',
    'how much is this going to cost me',
    'hello',
    '',
    'ca',
    '0x1234567890abcdef1234567890abcdef12345678',
    'x'.repeat(100),
  ])('ignores ordinary chat: "%s"', (text) => {
    expect(detectStatRequest(text)).toEqual([]);
  });
});

describe('stat replies show only what was asked', () => {
  const base = { symbol: 'AGALIO', onchain, market: marketOk };

  it('price only', () => {
    const html = buildStatReply({ ...base, topics: ['price'] })!;
    expect(html).toContain('$0.000123');
    expect(html).not.toContain('Market cap');
    expect(html).not.toContain('Liquidity');
    expect(html).toContain('Source: DexScreener');
  });

  it('several topics in the order asked', () => {
    const html = buildStatReply({ ...base, topics: ['marketcap', 'liquidity'] })!;
    expect(html.indexOf('Market cap')).toBeLessThan(html.indexOf('Liquidity'));
    expect(html).toContain('$1.23M');
    expect(html).toContain('$54.32K');
    expect(html).not.toContain('Price');
  });

  it('supply is read from on-chain data and needs no market source line', () => {
    const html = buildStatReply({ ...base, topics: ['supply'] })!;
    expect(html).toContain('1,000,000,000');
    expect(html).not.toContain('Source');
  });

  it('is honest when there is no pair or the provider is down', () => {
    expect(buildStatReply({ ...base, market: marketNoPair, topics: ['price'] })).toContain('No trading pair found yet');
    expect(buildStatReply({ ...base, market: marketDown, topics: ['price'] })).toContain('temporarily unavailable');
  });

  it('marks cached data and never invents holders', () => {
    expect(buildStatReply({ ...base, market: { ...marketOk, stale: true }, topics: ['price'] })).toContain('cached');
    expect(buildStatReply({ ...base, topics: ['holders'] })).toContain('not provided');
  });

  it('returns null without topics', () => {
    expect(buildStatReply({ ...base, topics: [] })).toBeNull();
  });
});

describe('"ca" reply', () => {
  it('is only the contract address, nothing else', () => {
    expect(buildContractOnlyHtml(OFFICIAL)).toBe(`<code>${OFFICIAL}</code>`);
  });
});
