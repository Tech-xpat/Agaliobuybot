import { describe, expect, it } from 'vitest';
import { buildButtonSpecs } from '../../src/bot/keyboards/announcement.keyboard';
import { renderUrlTemplate, validateExternalUrl } from '../../src/services/url.service';
import { baseContext, marketNoPair, marketOk, OFFICIAL } from '../fixtures';

describe('external URL validation', () => {
  it.each([
    'http://pancakeswap.finance/swap',
    'javascript:alert(1)',
    'ftp://example.com/x',
    'https://user:pass@example.com/',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://192.168.1.10/x',
    'https://10.0.0.5/x',
    'https://intranet/x',
    'https://example.com/has space',
    'not a url',
    '',
  ])('rejects %s', (bad) => {
    expect(() => validateExternalUrl(bad)).toThrow();
  });

  it('accepts a normal https URL and {contract} templates', () => {
    expect(validateExternalUrl('https://pancakeswap.finance/swap?chain=bsc&outputCurrency={contract}')).toContain('{contract}');
    expect(renderUrlTemplate('https://x.io/{contract}', { contract: OFFICIAL })).toBe(`https://x.io/${OFFICIAL}`);
  });
});

const flat = (rows: ReturnType<typeof buildButtonSpecs>) => rows.flat();
const keys = (rows: ReturnType<typeof buildButtonSpecs>) => flat(rows).map((b) => b.key);

describe('inline keyboard', () => {
  it('hides BUY when no buy URL is configured, even if trading is live', () => {
    const ctx = baseContext({ token: { ...baseContext().token, launchStatus: 'TRADING_LIVE', buyUrl: null } });
    expect(keys(buildButtonSpecs(ctx))).not.toContain('buy');
  });

  it('hides BUY until the launch status is TRADING_LIVE', () => {
    const ctx = baseContext({ token: { ...baseContext().token, launchStatus: 'TRADING_NOT_LIVE', buyUrl: 'https://pancakeswap.finance/swap' } });
    expect(keys(buildButtonSpecs(ctx))).not.toContain('buy');
  });

  it('shows BUY with the contract substituted when live and configured', () => {
    const ctx = baseContext({ token: { ...baseContext().token, launchStatus: 'TRADING_LIVE', buyUrl: 'https://pancakeswap.finance/swap?outputCurrency={contract}' } });
    const buy = flat(buildButtonSpecs(ctx)).find((b) => b.key === 'buy');
    expect(buy).toMatchObject({ kind: 'url', url: `https://pancakeswap.finance/swap?outputCurrency=${OFFICIAL}` });
  });

  it('omits a button whose URL is invalid instead of publishing it', () => {
    const ctx = baseContext({ token: { ...baseContext().token, launchStatus: 'TRADING_LIVE', buyUrl: 'javascript:alert(1)', websiteUrl: 'http://insecure.example' } });
    const k = keys(buildButtonSpecs(ctx));
    expect(k).not.toContain('buy');
    expect(k).not.toContain('website');
  });

  it('hides CHART when there is no configured URL and no pair', () => {
    expect(keys(buildButtonSpecs(baseContext({ market: marketNoPair })))).not.toContain('chart');
  });

  it('uses the pair URL for CHART when market data provides one', () => {
    const chart = flat(buildButtonSpecs(baseContext({ market: marketOk }))).find((b) => b.key === 'chart');
    expect(chart).toMatchObject({ kind: 'url', url: expect.stringContaining('dexscreener.com') });
  });

  it('always has working COPY / DETAILS callbacks and a BscScan link', () => {
    const specs = flat(buildButtonSpecs(baseContext()));
    expect(specs.find((b) => b.key === 'copy')).toMatchObject({ kind: 'callback', data: 'c:copy' });
    expect(specs.find((b) => b.key === 'details')).toMatchObject({ kind: 'callback', data: 'c:details' });
    expect(specs.find((b) => b.key === 'bscscan')).toMatchObject({ kind: 'url', url: `https://bscscan.com/token/${OFFICIAL}` });
  });

  it('respects admin-disabled buttons', () => {
    const ctx = baseContext({ buttons: [{ key: 'copy', enabled: false }, { key: 'bscscan', enabled: false }] });
    const k = keys(buildButtonSpecs(ctx));
    expect(k).not.toContain('copy');
    expect(k).not.toContain('bscscan');
    expect(k).toContain('details');
  });

  it('only shows HOLDERS / COMMUNITY when a URL is configured', () => {
    expect(keys(buildButtonSpecs(baseContext()))).not.toContain('community');
    const ctx = baseContext({ token: { ...baseContext().token, communityUrl: 'https://t.me/agalio_holders' } });
    expect(keys(buildButtonSpecs(ctx))).toContain('community');
  });

  it('keeps callback data within Telegram’s 64-byte limit', () => {
    for (const b of flat(buildButtonSpecs(baseContext()))) if (b.kind === 'callback') expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
  });
});
