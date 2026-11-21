import { DEFAULT_BUTTON_LABELS, type ButtonKey, type LaunchStatusValue } from '../config/constants';
import type { LinkTopic } from '../detection/link-keyword-detector';
import { renderUrlTemplate, safeUrl } from '../services/url.service';
import type { ButtonSetting, ButtonSpec } from '../types';

type SingleTopic = Exclude<LinkTopic, 'all'>;

export interface LinkReplyToken {
  launchStatus: LaunchStatusValue;
  buyUrl: string | null;
  chartUrl: string | null;
  communityUrl: string | null;
  websiteUrl: string | null;
  twitterUrl: string | null;
  whitepaperUrl: string | null;
  tokenomicsUrl: string | null;
  securityUrl: string | null;
  tutorialUrl: string | null;
}

export interface LinkReplyInput {
  topics: LinkTopic[];
  token: LinkReplyToken;
  buttons: ButtonSetting[];
  /** Needed to fill {contract} in link templates. Null while no official contract is set. */
  contractChecksum: string | null;
  /** DexScreener pair link, used for "chart" when the admin set no chart link. */
  marketChartUrl: string | null;
}

export interface LinkReply {
  /** Telegram HTML text shown above the buttons. */
  html: string;
  /** Tappable URL buttons, two per row. May be empty when there is only a note to show. */
  rows: ButtonSpec[][];
}

const META: Record<SingleTopic, { key: ButtonKey; icon: string; label: string }> = {
  website: { key: 'website', icon: '🌐', label: 'Website' },
  twitter: { key: 'twitter', icon: '𝕏', label: 'Twitter / X' },
  whitepaper: { key: 'whitepaper', icon: '📄', label: 'Whitepaper' },
  tokenomics: { key: 'tokenomics', icon: '🥧', label: 'Tokenomics' },
  security: { key: 'security', icon: '🛡', label: 'Security / audit' },
  tutorial: { key: 'tutorial', icon: '🎓', label: 'Video tutorials' },
  community: { key: 'community', icon: '👥', label: 'Community' },
  chart: { key: 'chart', icon: '📈', label: 'Chart' },
  buy: { key: 'buy', icon: '🟢', label: 'Buy' },
};

const ALL_ORDER: SingleTopic[] = ['tutorial', 'website', 'twitter', 'community', 'chart', 'tokenomics', 'whitepaper', 'security', 'buy'];

const HEADER = '🔗 <b>Tap a button to open</b> 👇';

function rawUrl(topic: SingleTopic, i: LinkReplyInput): string | null {
  const t = i.token;
  switch (topic) {
    case 'website': return t.websiteUrl;
    case 'twitter': return t.twitterUrl;
    case 'whitepaper': return t.whitepaperUrl;
    case 'tokenomics': return t.tokenomicsUrl;
    case 'security': return t.securityUrl;
    case 'tutorial': return t.tutorialUrl;
    case 'community': return t.communityUrl;
    case 'chart': return t.chartUrl ?? i.marketChartUrl;
    // Same rule as the announcement button: the buy link is only ever shown when trading is live.
    case 'buy': return t.launchStatus === 'TRADING_LIVE' ? t.buyUrl : null;
  }
}

function resolveUrl(topic: SingleTopic, i: LinkReplyInput): string | null {
  const raw = rawUrl(topic, i);
  if (!raw) return null;
  if (raw.includes('{contract}') && !i.contractChecksum) return null;
  return safeUrl(renderUrlTemplate(raw, { contract: i.contractChecksum ?? '' }));
}

/**
 * Builds the group reply for a link request: a short text plus tappable URL buttons, or null when
 * there is nothing to say. Button labels match the announcement buttons (including any custom label
 * an admin set). Respects the admin's button on/off switches and never shows a link that fails URL validation.
 */
export function buildLinkReply(input: LinkReplyInput): LinkReply | null {
  const setting = (key: ButtonKey) => input.buttons.find((b) => b.key === key);
  const enabled = (key: ButtonKey) => setting(key)?.enabled ?? true;
  const label = (key: ButtonKey) => setting(key)?.label?.trim() || DEFAULT_BUTTON_LABELS[key];

  const askedForAll = input.topics.includes('all');
  const topics: SingleTopic[] = askedForAll ? ALL_ORDER : (input.topics as SingleTopic[]);

  const buttons: ButtonSpec[] = [];
  const notes: string[] = [];
  for (const topic of topics) {
    const { key, icon, label: name } = META[topic];
    if (!enabled(key)) continue;
    const url = resolveUrl(topic, input);
    if (url) {
      buttons.push({ kind: 'url', key, text: label(key), url });
    } else if (!askedForAll) {
      // Asked for this one specifically: say honestly why there is no link.
      notes.push(
        topic === 'buy' && input.token.launchStatus !== 'TRADING_LIVE'
          ? `${icon} <b>${name}:</b> trading has not been announced as live yet. Please wait for an official announcement.`
          : `${icon} <b>${name}:</b> not available yet.`,
      );
    }
  }

  if (buttons.length === 0 && notes.length === 0) return null;

  const rows: ButtonSpec[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  const html = [buttons.length > 0 ? HEADER : null, ...notes].filter((p): p is string => p !== null).join('\n\n');
  return { html, rows };
}
