import { InlineKeyboard } from 'grammy';
import { DEFAULT_BUTTON_LABELS, type ButtonKey } from '../../config/constants';
import { bscscanTokenUrl, renderUrlTemplate, safeUrl } from '../../services/url.service';
import { CALLBACK_COPY, CALLBACK_DETAILS, type AnnouncementContext, type ButtonSpec } from '../../types';

/**
 * Pure function: turns the announcement context into button specs.
 * A button is only emitted when it is enabled AND has a working destination.
 * - BUY only when status is TRADING_LIVE and a valid buy URL is configured.
 * - CHART only when a chart URL is configured or a real pair URL was found.
 */
export function buildButtonSpecs(ctx: AnnouncementContext): ButtonSpec[][] {
  const { token, contract } = ctx;
  const setting = (key: ButtonKey) => ctx.buttons.find((b) => b.key === key);
  const enabled = (key: ButtonKey) => setting(key)?.enabled ?? true;
  const label = (key: ButtonKey) => setting(key)?.label?.trim() || DEFAULT_BUTTON_LABELS[key];
  const url = (key: ButtonKey, raw: string | null): ButtonSpec | null => {
    if (!enabled(key)) return null;
    const valid = safeUrl(raw ? renderUrlTemplate(raw, { contract: contract.checksum }) : null);
    return valid ? { kind: 'url', key, text: label(key), url: valid } : null;
  };
  const cb = (key: ButtonKey, data: string): ButtonSpec | null =>
    enabled(key) ? { kind: 'callback', key, text: label(key), data } : null;

  const buy = token.launchStatus === 'TRADING_LIVE' ? url('buy', token.buyUrl) : null;
  const chart = url('chart', token.chartUrl ?? ctx.market.data?.chartUrl ?? null);
  const community = url('community', token.communityUrl);
  const bscscan = url('bscscan', bscscanTokenUrl(ctx.bscscanBaseUrl, contract.checksum));

  const primary: (ButtonSpec | null)[][] = [
    [buy, chart],
    [cb('copy', CALLBACK_COPY), cb('details', CALLBACK_DETAILS)],
    [community, bscscan],
  ];
  const secondary: (ButtonSpec | null)[] = [
    url('tutorial', token.tutorialUrl),
    url('website', token.websiteUrl),
    url('twitter', token.twitterUrl),
    url('telegram', ctx.telegramGroupUrl),
    url('tokenomics', token.tokenomicsUrl),
    url('whitepaper', token.whitepaperUrl),
    url('security', token.securityUrl),
  ];

  const rows: ButtonSpec[][] = primary.map((r) => r.filter((b): b is ButtonSpec => b !== null));
  const sec = secondary.filter((b): b is ButtonSpec => b !== null);
  for (let i = 0; i < sec.length; i += 2) rows.push(sec.slice(i, i + 2));
  return rows.filter((r) => r.length > 0);
}

export function toInlineKeyboard(rows: ButtonSpec[][]): InlineKeyboard {
  const kb = new InlineKeyboard();
  rows.forEach((row, i) => {
    for (const b of row) {
      if (b.kind === 'url') kb.url(b.text, b.url);
      else kb.text(b.text, b.data);
    }
    if (i < rows.length - 1) kb.row();
  });
  return kb;
}
