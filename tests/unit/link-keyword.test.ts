import { describe, expect, it } from 'vitest';
import { buildLinkReply, type LinkReplyInput } from '../../src/announcements/link-reply';
import { detectLinkRequest } from '../../src/detection/link-keyword-detector';

describe('link keyword detection', () => {
  it.each([
    ['website', ['website']],
    ['Website?', ['website']],
    ['wen website', ['website']],
    ["what's the website", ['website']],
    ['official site pls', ['website']],
    ['twitter', ['twitter']],
    ['twitter link', ['twitter']],
    ['twitter or x', ['twitter']],
    ['twitter/x?', ['twitter']],
    ['official x link', ['twitter']],
    ['x account', ['twitter']],
    ['where is the x page', ['twitter']],
    ['whitepaper', ['whitepaper']],
    ['white paper?', ['whitepaper']],
    ['wen whitepaper', ['whitepaper']],
    ['tokenomics', ['tokenomics']],
    ['token economics pls', ['tokenomics']],
    ['audit', ['security']],
    ['chart', ['chart']],
    ['chart link', ['chart']],
    ['community link', ['community']],
    ['how to buy', ['buy']],
    ['buy link', ['buy']],
    ['website and twitter', ['website', 'twitter']],
    ['whitepaper & tokenomics?', ['whitepaper', 'tokenomics']],
    ['🌐 website 🌐', ['website']],
    ['socials', ['all']],
    ['links', ['all']],
    ['all links pls', ['all']],
  ])('matches %j', (text, expected) => {
    expect(detectLinkRequest(text)).toEqual(expected);
  });

  it.each([
    '',
    'x',
    'X?',
    'buy',
    'buy buy buy',
    'link',
    'page',
    'my website is down',
    'website coming soon?',
    'is the website real',
    'x is going to pump',
    'i love the tokenomics of this project',
    'tokenomics look great',
    'whitepaper was written by a chatgpt lol',
    'hello website',
    'chart is red today',
    'community is growing so fast, amazing work team',
    'ca',
    'what is the price',
    'website website website website website website website website website website',
    '0xabc0000000000000000000000000000000000001',
  ])('does not match %j', (text) => {
    expect(detectLinkRequest(text)).toEqual([]);
  });
});

describe('link reply', () => {
  const base: LinkReplyInput = {
    topics: ['website'],
    token: {
      launchStatus: 'PRE_LAUNCH',
      buyUrl: 'https://pancakeswap.finance/swap?chain=bsc&outputCurrency={contract}',
      chartUrl: null,
      communityUrl: null,
      websiteUrl: 'https://agalio.example/',
      twitterUrl: 'https://x.com/agalio',
      whitepaperUrl: null,
      tokenomicsUrl: 'https://agalio.example/tokenomics',
      securityUrl: null,
    },
    buttons: [],
    contractChecksum: '0x1111111111111111111111111111111111111111',
    marketChartUrl: null,
  };

  it('returns the requested link', () => {
    expect(buildLinkReply(base)).toBe('🌐 <b>Website:</b> https://agalio.example/');
  });

  it('returns several links in the order asked', () => {
    const r = buildLinkReply({ ...base, topics: ['twitter', 'website'] })!;
    expect(r.split('\n')).toEqual(['𝕏 <b>Twitter / X:</b> https://x.com/agalio', '🌐 <b>Website:</b> https://agalio.example/']);
  });

  it('says so honestly when a requested link is not set', () => {
    expect(buildLinkReply({ ...base, topics: ['whitepaper'] })).toBe('📄 <b>Whitepaper:</b> not available yet.');
  });

  it('skips topics the admin switched off', () => {
    expect(buildLinkReply({ ...base, buttons: [{ key: 'website', enabled: false }] })).toBeNull();
  });

  it('never shows the buy link unless trading is live', () => {
    const notLive = buildLinkReply({ ...base, topics: ['buy'] })!;
    expect(notLive).toContain('not been announced as live');
    expect(notLive).not.toContain('pancakeswap');
    const live = buildLinkReply({ ...base, topics: ['buy'], token: { ...base.token, launchStatus: 'TRADING_LIVE' } })!;
    expect(live).toContain('outputCurrency=0x1111111111111111111111111111111111111111');
  });

  it('falls back to the market chart link', () => {
    const r = buildLinkReply({ ...base, topics: ['chart'], marketChartUrl: 'https://dexscreener.com/bsc/0xpair' });
    expect(r).toBe('📈 <b>Chart:</b> https://dexscreener.com/bsc/0xpair');
  });

  it('"all" lists only links that exist and says nothing when none exist', () => {
    const r = buildLinkReply({ ...base, topics: ['all'] })!;
    expect(r.split('\n')).toHaveLength(3); // website, twitter, tokenomics
    expect(r).not.toContain('not available');
    const empty = buildLinkReply({ ...base, topics: ['all'], token: { ...base.token, websiteUrl: null, twitterUrl: null, tokenomicsUrl: null } });
    expect(empty).toBeNull();
  });

  it('drops links that fail URL validation and escapes HTML', () => {
    expect(buildLinkReply({ ...base, token: { ...base.token, websiteUrl: 'http://insecure.example' } })).toBe('🌐 <b>Website:</b> not available yet.');
    const r = buildLinkReply({ ...base, token: { ...base.token, websiteUrl: 'https://agalio.example/?a=1&b=<2>' } })!;
    expect(r).not.toContain('<2>');
    expect(r).toContain('&amp;b=');
  });

  it('skips a {contract} template when no contract is set', () => {
    const r = buildLinkReply({ ...base, topics: ['buy'], token: { ...base.token, launchStatus: 'TRADING_LIVE' }, contractChecksum: null });
    expect(r).toBe('🟢 <b>Buy:</b> not available yet.');
  });
});
