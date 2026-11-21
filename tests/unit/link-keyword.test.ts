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
    ['tutorial', ['tutorial']],
    ['tutorials?', ['tutorial']],
    ['wen video tutorial', ['tutorial']],
    ['video guide pls', ['tutorial']],
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
    'this video is fake',
    'the tutorial was too long',
    'community is growing so fast, amazing work team',
    'ca',
    'what is the price',
    'website website website website website website website website website website',
    '0xabc0000000000000000000000000000000000001',
  ])('does not match %j', (text) => {
    expect(detectLinkRequest(text)).toEqual([]);
  });
});

describe('link reply (tappable buttons)', () => {
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
      tutorialUrl: null,
    },
    buttons: [],
    contractChecksum: '0x1111111111111111111111111111111111111111',
    marketChartUrl: null,
  };
  const urls = (r: ReturnType<typeof buildLinkReply>) => r?.rows.flat().map((b) => (b.kind === 'url' ? b.url : ''));

  it('returns the requested link as a tappable URL button', () => {
    const r = buildLinkReply(base)!;
    expect(r.rows).toEqual([[{ kind: 'url', key: 'website', text: '🌐 Website', url: 'https://agalio.example/' }]]);
    expect(r.html).toContain('Tap a button');
    expect(r.html).not.toContain('agalio.example'); // the link lives in the button, not the text
  });

  it('puts several links in the order asked, two buttons per row', () => {
    const r = buildLinkReply({ ...base, topics: ['twitter', 'website', 'tokenomics'] })!;
    expect(urls(r)).toEqual(['https://x.com/agalio', 'https://agalio.example/', 'https://agalio.example/tokenomics']);
    expect(r.rows.map((row) => row.length)).toEqual([2, 1]);
  });

  it('uses the admin custom button label when one is set', () => {
    const r = buildLinkReply({ ...base, buttons: [{ key: 'website', enabled: true, label: 'Visit our site' }] })!;
    expect(r.rows[0]![0]!.text).toBe('Visit our site');
  });

  it('says so honestly (no button) when a requested link is not set', () => {
    const r = buildLinkReply({ ...base, topics: ['whitepaper'] })!;
    expect(r.rows).toEqual([]);
    expect(r.html).toBe('📄 <b>Whitepaper:</b> not available yet.');
  });

  it('mixes buttons for links that exist with a note for the one that does not', () => {
    const r = buildLinkReply({ ...base, topics: ['website', 'whitepaper'] })!;
    expect(urls(r)).toEqual(['https://agalio.example/']);
    expect(r.html).toContain('Whitepaper:</b> not available yet');
  });

  it('gives the tutorial link as a button, and says so when the admin has not set one', () => {
    const set = buildLinkReply({ ...base, topics: ['tutorial'], token: { ...base.token, tutorialUrl: 'https://youtube.com/playlist?list=abc' } })!;
    expect(set.rows).toEqual([[{ kind: 'url', key: 'tutorial', text: '🎓 VIDEO TUTORIALS', url: 'https://youtube.com/playlist?list=abc' }]]);
    expect(buildLinkReply({ ...base, topics: ['tutorial'] })!.html).toBe('🎓 <b>Video tutorials:</b> not available yet.');
  });

  it('skips topics the admin switched off', () => {
    expect(buildLinkReply({ ...base, buttons: [{ key: 'website', enabled: false }] })).toBeNull();
  });

  it('never gives the buy link unless trading is live', () => {
    const notLive = buildLinkReply({ ...base, topics: ['buy'] })!;
    expect(notLive.rows).toEqual([]);
    expect(notLive.html).toContain('not been announced as live');
    const live = buildLinkReply({ ...base, topics: ['buy'], token: { ...base.token, launchStatus: 'TRADING_LIVE' } });
    expect(urls(live)![0]).toContain('outputCurrency=0x1111111111111111111111111111111111111111');
  });

  it('falls back to the market chart link', () => {
    const r = buildLinkReply({ ...base, topics: ['chart'], marketChartUrl: 'https://dexscreener.com/bsc/0xpair' });
    expect(urls(r)).toEqual(['https://dexscreener.com/bsc/0xpair']);
  });

  it('"all" gives a button for every link that exists and says nothing when none exist', () => {
    const r = buildLinkReply({ ...base, topics: ['all'] })!;
    expect(urls(r)).toEqual(['https://agalio.example/', 'https://x.com/agalio', 'https://agalio.example/tokenomics']);
    expect(r.html).not.toContain('not available');
    const empty = buildLinkReply({ ...base, topics: ['all'], token: { ...base.token, websiteUrl: null, twitterUrl: null, tokenomicsUrl: null } });
    expect(empty).toBeNull();
  });

  it('drops links that fail URL validation', () => {
    const r = buildLinkReply({ ...base, token: { ...base.token, websiteUrl: 'http://insecure.example' } })!;
    expect(r.rows).toEqual([]);
    expect(r.html).toBe('🌐 <b>Website:</b> not available yet.');
  });

  it('skips a {contract} template when no contract is set', () => {
    const r = buildLinkReply({ ...base, topics: ['buy'], token: { ...base.token, launchStatus: 'TRADING_LIVE' }, contractChecksum: null })!;
    expect(r.rows).toEqual([]);
    expect(r.html).toBe('🟢 <b>Buy:</b> not available yet.');
  });
});
