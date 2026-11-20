import { describe, expect, it } from 'vitest';
import { buildAnnouncementHtml, buildDetailsHtml } from '../../src/announcements/announcement.builder';
import { validateTemplate } from '../../src/announcements/announcement.templates';
import { UNAVAILABLE } from '../../src/config/constants';
import { baseContext, marketDown, marketNoPair, marketOk, OFFICIAL } from '../fixtures';

describe('announcement generation', () => {
  it('shows verified on-chain data and live market data when available', () => {
    const html = buildAnnouncementHtml(baseContext({ market: marketOk }));
    expect(html).toContain(`<code>${OFFICIAL}</code>`);
    expect(html).toContain('Decimals: 18');
    expect(html).toContain('1,000,000,000');
    expect(html).toContain('$0.000123');
    expect(html).toContain('$1.23M');
    expect(html).toContain('$54.32K');
  });

  it('shows "Data currently unavailable" (never zeros) when the token has no pair yet', () => {
    const html = buildAnnouncementHtml(baseContext({ market: marketNoPair }));
    expect(html).toContain(`Price: ${UNAVAILABLE}`);
    expect(html).toContain(`Liquidity: ${UNAVAILABLE}`);
    expect(html).toContain(`Holders: ${UNAVAILABLE}`);
    expect(html).not.toMatch(/\$0(\.00)?\b/);
    expect(html).toContain('No trading pair found yet');
  });

  it('keeps working when the market provider is down', () => {
    const html = buildAnnouncementHtml(baseContext({ market: marketDown }));
    expect(html).toContain(`Price: ${UNAVAILABLE}`);
    expect(html).toContain('currently unavailable');
  });

  it('marks stale cached data', () => {
    const html = buildAnnouncementHtml(baseContext({ market: { ...marketOk, stale: true } }));
    expect(html).toContain('cached, may be outdated');
  });

  it('degrades gracefully when on-chain data cannot be read', () => {
    const html = buildAnnouncementHtml(baseContext({ onchain: null }));
    expect(html).toContain(`Decimals: ${UNAVAILABLE}`);
    expect(html).toContain(`Total supply: ${UNAVAILABLE}`);
  });

  it('warns when no contract code exists at the address yet', () => {
    const html = buildAnnouncementHtml(baseContext({ onchain: { ...baseContext().onchain!, hasCode: false } }));
    expect(html).toContain('No contract code found');
  });

  it('escapes admin-supplied and API-supplied text', () => {
    const ctx = baseContext();
    ctx.token.description = '<script>alert(1)</script> & <b>bold</b>';
    ctx.token.name = 'A<B>';
    const html = buildAnnouncementHtml(ctx);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&lt;B&gt;');
    expect(html).toContain('&amp;');
  });

  it.each([
    ['PRE_LAUNCH', 'PRE-LAUNCH'],
    ['CONTRACT_DEPLOYED', 'CONTRACT DEPLOYED'],
    ['TRADING_NOT_LIVE', 'TRADING NOT YET LIVE'],
    ['TRADING_LIVE', 'TRADING LIVE'],
    ['PAUSED', 'PAUSED'],
    ['ANNOUNCEMENT_ONLY', 'ANNOUNCEMENT ONLY'],
  ] as const)('launch status %s renders as %s', (status, label) => {
    const ctx = baseContext();
    ctx.token.launchStatus = status;
    expect(buildAnnouncementHtml(ctx)).toContain(label);
  });

  it('never claims trading is live unless the status is TRADING_LIVE', () => {
    for (const s of ['PRE_LAUNCH', 'CONTRACT_DEPLOYED', 'TRADING_NOT_LIVE', 'PAUSED', 'ANNOUNCEMENT_ONLY'] as const) {
      const ctx = baseContext();
      ctx.token.launchStatus = s;
      expect(buildAnnouncementHtml(ctx)).not.toMatch(/trading (has been announced as )?live/i);
    }
  });

  it('flags TRADING_LIVE with no detected pair rather than pretending data exists', () => {
    const ctx = baseContext({ market: marketNoPair });
    ctx.token.launchStatus = 'TRADING_LIVE';
    expect(buildAnnouncementHtml(ctx)).toContain('No DEX trading pair has been detected');
  });

  it('labels TEST announcements', () => {
    expect(buildAnnouncementHtml(baseContext({ kind: 'TEST' }))).toContain('TEST ANNOUNCEMENT');
  });

  it('uses an admin template and falls back to the default if its HTML is broken', () => {
    const good = buildAnnouncementHtml(baseContext({ template: '<b>{{symbol}}</b> at <code>{{contract}}</code>' }));
    expect(good).toBe(`<b>AGALIO</b> at <code>${OFFICIAL}</code>`);
    const broken = buildAnnouncementHtml(baseContext({ template: '<b>{{symbol}} <code>{{contract}}' }));
    expect(broken).toContain('Official contract');
  });

  it('stays within Telegram limits even with a very long description', () => {
    const ctx = baseContext();
    ctx.token.description = 'x'.repeat(800);
    expect(buildAnnouncementHtml(ctx).length).toBeLessThanOrEqual(4096);
    expect(buildDetailsHtml(ctx).length).toBeLessThanOrEqual(4096);
  });

  it('separates verified, third-party and admin-supplied information', () => {
    const html = buildAnnouncementHtml(baseContext());
    expect(html).toMatch(/On-chain/);
    expect(html).toMatch(/third-party/);
    expect(html).toMatch(/provided by AGALIO admins/);
    expect(html).not.toMatch(/\b(is audited|is safe|guaranteed)\b/i);
  });
});

describe('template validation', () => {
  it('rejects unknown placeholders, disallowed tags, stray markup and a missing contract', () => {
    expect(() => validateTemplate('{{contract}} {{nope}}')).toThrow(/Unknown placeholders/);
    expect(() => validateTemplate('<script>x</script>{{contract}}')).toThrow(/not allowed/);
    expect(() => validateTemplate('<b>{{contract}}')).toThrow(/Unclosed/);
    expect(() => validateTemplate('a < b {{contract}}')).toThrow(/Stray/);
    expect(() => validateTemplate('<b>{{name}}</b>')).toThrow(/contract/);
    expect(() => validateTemplate('<a href="javascript:x">x</a>{{contract}}')).toThrow(/Links/);
  });

  it('accepts a valid template', () => {
    expect(() => validateTemplate('<b>{{name}}</b>\n<code>{{contract}}</code>\n<a href="https://agalio.example">site</a>')).not.toThrow();
  });
});
