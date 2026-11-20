import { CHAIN_NAME, LAUNCH_STATUS_LABELS, LAUNCH_STATUS_NOTES, UNAVAILABLE } from '../config/constants';
import type { AnnouncementContext } from '../types';
import { escapeAttr, escapeHtml } from '../utils/sanitizers';
import {
  formatDate,
  formatPercent,
  formatSupply,
  formatUsdCompact,
  formatUsdPrice,
} from '../utils/formatters';
import { bscscanTokenUrl, safeUrl } from '../services/url.service';
import { DEFAULT_TEMPLATE, renderTemplate, validateTelegramHtml } from './announcement.templates';

/** All values are HTML-escaped here, so templates can never inject markup through data. */
export function buildValues(ctx: AnnouncementContext): Record<string, string> {
  const { token, onchain, market } = ctx;
  const m = market.status === 'ok' ? market.data : null;

  const notes: string[] = [LAUNCH_STATUS_NOTES[token.launchStatus]];
  if (onchain && !onchain.hasCode) notes.push('⚠️ No contract code found at this address on BSC yet.');
  if (token.launchStatus === 'TRADING_LIVE' && market.status === 'no_pair') {
    notes.push('⚠️ No DEX trading pair has been detected by the data provider yet.');
  }

  let marketNote = '';
  if (market.status === 'no_pair') marketNote = 'No trading pair found yet. No market data to show.';
  else if (market.status === 'unavailable') marketNote = 'Market data provider is currently unavailable.';
  else if (market.stale) marketNote = `Source: ${market.providerName} (cached, may be outdated)`;
  else if (m) marketNote = `Source: ${market.providerName}`;

  const v: Record<string, string> = {
    name: token.name,
    symbol: token.symbol,
    contract: ctx.contract.checksum,
    chain: CHAIN_NAME,
    status: LAUNCH_STATUS_LABELS[token.launchStatus],
    status_note: notes.join('\n'),
    decimals: onchain?.decimals !== null && onchain?.decimals !== undefined ? String(onchain.decimals) : UNAVAILABLE,
    total_supply: formatSupply(onchain?.totalSupply, onchain?.decimals),
    price: formatUsdPrice(m?.priceUsd),
    market_cap: formatUsdCompact(m?.marketCapUsd),
    fdv: formatUsdCompact(m?.fdvUsd),
    liquidity: formatUsdCompact(m?.liquidityUsd),
    volume_24h: formatUsdCompact(m?.volume24hUsd),
    price_change_24h: formatPercent(m?.priceChange24hPct),
    holders: m?.holderCount != null ? m.holderCount.toLocaleString('en-US') : UNAVAILABLE,
    dex: m?.dexName ?? UNAVAILABLE,
    pair: m?.pairAddress ?? UNAVAILABLE,
    pair_created: formatDate(m?.pairCreatedAt),
    market_note: marketNote,
    description: token.description || 'No description has been set yet.',
  };
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, escapeHtml(val)]));
}

const prefix = (ctx: AnnouncementContext) => (ctx.kind === 'TEST' ? '🧪 <b>TEST ANNOUNCEMENT</b>\n\n' : ctx.kind === 'PREVIEW' ? '👁 <b>PREVIEW</b>\n\n' : '');

export function buildAnnouncementHtml(ctx: AnnouncementContext): string {
  const values = buildValues(ctx);
  let html = renderTemplate(ctx.template ?? DEFAULT_TEMPLATE, values);
  try {
    validateTelegramHtml(html);
  } catch {
    html = renderTemplate(DEFAULT_TEMPLATE, values); // never send broken custom HTML
  }
  html = prefix(ctx) + html;
  if (html.length > 4096) html = prefix(ctx) + renderTemplate(DEFAULT_TEMPLATE, values);
  return html;
}

/** Longer "Token Details" view with provenance sections and external links. */
export function buildDetailsHtml(ctx: AnnouncementContext): string {
  const v = buildValues(ctx);
  const link = (text: string, raw: string | null) => {
    const url = safeUrl(raw);
    return url ? `• <a href="${escapeAttr(url)}">${escapeHtml(text)}</a>` : null;
  };
  const links = [
    link('Website', ctx.token.websiteUrl),
    link('X / Twitter', ctx.token.twitterUrl),
    link('Community', ctx.token.communityUrl),
    link('Telegram group', ctx.telegramGroupUrl),
    link('Tokenomics', ctx.token.tokenomicsUrl),
    link('Whitepaper', ctx.token.whitepaperUrl),
    link('Security information', ctx.token.securityUrl),
    link('BscScan', bscscanTokenUrl(ctx.bscscanBaseUrl, ctx.contract.checksum)),
  ].filter((l): l is string => l !== null);

  const lines = [
    `<b>${v.name} (${v.symbol}) — Details</b>`,
    `Status: <b>${v.status}</b>`,
    '',
    `<b>⛓ On-chain facts (read from BSC RPC)</b>`,
    `Network: ${v.chain}`,
    `Contract: <code>${v.contract}</code>`,
    `Decimals: ${v.decimals}`,
    `Total supply: ${v.total_supply}`,
    '',
    `<b>📊 Market data (third-party, may be delayed)</b>`,
    `Price: ${v.price}`,
    `24h change: ${v.price_change_24h}`,
    `Market cap: ${v.market_cap}`,
    `FDV: ${v.fdv}`,
    `Liquidity: ${v.liquidity}`,
    `24h volume: ${v.volume_24h}`,
    `Holders: ${v.holders}`,
    `DEX: ${v.dex}`,
    `Pair: <code>${v.pair}</code>`,
    `Pair created: ${v.pair_created}`,
    v.market_note,
    '',
    `<b>ℹ️ Project info (provided by AGALIO admins)</b>`,
    v.description,
  ];
  if (links.length) lines.push('', '<b>🔗 Official links</b>', ...links);
  lines.push('', '<i>Not financial advice. This bot does not audit tokens or vouch for safety. Never share your seed phrase or private keys with anyone.</i>');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 4090);
}

export function buildCopyContractHtml(checksum: string): string {
  return `<b>Official AGALIO contract (BSC)</b>\nTap the address below to copy it:\n\n<code>${escapeHtml(checksum)}</code>\n\n<i>Always compare it with the pinned/official sources.</i>`;
}
