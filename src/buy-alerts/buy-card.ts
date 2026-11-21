import { DEFAULT_BUTTON_LABELS, type ButtonKey } from '../config/constants';
import { renderUrlTemplate, safeUrl } from '../services/url.service';
import type { ButtonSetting, ButtonSpec } from '../types';
import { escapeAttr, escapeHtml } from '../utils/sanitizers';
import { formatUsdCompact, formatUsdPrice, shortAddress } from '../utils/formatters';

export interface BuyCardInput {
  symbol: string;
  /** formatted amounts, e.g. "1,234,567.89" */
  tokenAmountText: string;
  quoteAmountText: string;
  quoteSymbol: string;
  /** estimated USD value of the buy, when known */
  usd: number | null;
  buyer: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  bscscanBaseUrl: string;
  txHash: string;
  token: { launchStatus: string; buyUrl: string | null; chartUrl: string | null };
  marketChartUrl: string | null;
  contractChecksum: string;
  buttons: ButtonSetting[];
}

export interface BuyCard {
  html: string;
  rows: ButtonSpec[][];
}

/** One green dot per $STEP of the buy, so big buys visibly stand out. Always at least 1, at most MAX. */
export const EMOJI_STEP_USD = 25;
export const EMOJI_MAX = 30;

export function buyBar(usd: number | null): string {
  const n = usd === null || !Number.isFinite(usd) ? 1 : Math.min(EMOJI_MAX, Math.max(1, Math.floor(usd / EMOJI_STEP_USD)));
  return '🟢'.repeat(n);
}

const base = (u: string) => u.replace(/\/+$/, '');
export const txUrl = (bscscanBase: string, hash: string) => `${base(bscscanBase)}/tx/${hash}`;
export const addressUrl = (bscscanBase: string, addr: string) => `${base(bscscanBase)}/address/${addr}`;

/** The "smart card" posted in the group for each buy. All dynamic values are escaped. */
export function buildBuyCard(i: BuyCardInput): BuyCard {
  const sym = escapeHtml(i.symbol);
  const usdText = i.usd !== null && Number.isFinite(i.usd) ? ` (${escapeHtml(formatUsdCompact(i.usd))})` : '';
  const buyerLink = `<a href="${escapeAttr(addressUrl(i.bscscanBaseUrl, i.buyer))}">${escapeHtml(shortAddress(i.buyer))}</a>`;

  const lines = [
    `<b>${sym} BUY!</b>`,
    buyBar(i.usd),
    '',
    `💸 <b>Spent:</b> ${escapeHtml(i.quoteAmountText)} ${escapeHtml(i.quoteSymbol)}${usdText}`,
    `🪙 <b>Got:</b> ${escapeHtml(i.tokenAmountText)} ${sym}`,
    `👤 <b>Buyer:</b> ${buyerLink}`,
  ];
  const stats: string[] = [];
  if (i.priceUsd !== null && i.priceUsd > 0) stats.push(`💰 <b>Price:</b> ${escapeHtml(formatUsdPrice(i.priceUsd))}`);
  if (i.marketCapUsd !== null) stats.push(`📊 <b>Market cap:</b> ${escapeHtml(formatUsdCompact(i.marketCapUsd))}`);
  if (i.liquidityUsd !== null) stats.push(`💧 <b>Liquidity:</b> ${escapeHtml(formatUsdCompact(i.liquidityUsd))}`);
  if (stats.length > 0) lines.push('', ...stats);

  return { html: lines.join('\n'), rows: buildRows(i) };
}

function buildRows(i: BuyCardInput): ButtonSpec[][] {
  const setting = (key: ButtonKey) => i.buttons.find((b) => b.key === key);
  const enabled = (key: ButtonKey) => setting(key)?.enabled ?? true;
  const label = (key: ButtonKey) => setting(key)?.label?.trim() || DEFAULT_BUTTON_LABELS[key];
  const resolve = (raw: string | null) => safeUrl(raw ? renderUrlTemplate(raw, { contract: i.contractChecksum }) : null);

  const row: ButtonSpec[] = [];
  if (enabled('bscscan')) row.push({ kind: 'url', key: 'bscscan', text: '🔍 TX', url: txUrl(i.bscscanBaseUrl, i.txHash) });
  const chart = enabled('chart') ? resolve(i.token.chartUrl ?? i.marketChartUrl) : null;
  if (chart) row.push({ kind: 'url', key: 'chart', text: label('chart'), url: chart });
  // Same rule as the announcement: the buy link only ever appears when trading was announced as live.
  const buy = enabled('buy') && i.token.launchStatus === 'TRADING_LIVE' ? resolve(i.token.buyUrl) : null;
  if (buy) row.push({ kind: 'url', key: 'buy', text: label('buy'), url: buy });
  return row.length > 0 ? [row] : [];
}
