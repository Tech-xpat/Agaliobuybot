import type { ButtonKey, LaunchStatusValue } from '../config/constants';
import type { LinkTopic } from '../detection/link-keyword-detector';
import { renderUrlTemplate, safeUrl } from '../services/url.service';
import type { ButtonSetting } from '../types';
import { escapeHtml } from '../utils/sanitizers';

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

const META: Record<SingleTopic, { key: ButtonKey; icon: string; label: string }> = {
  website: { key: 'website', icon: '🌐', label: 'Website' },
  twitter: { key: 'twitter', icon: '𝕏', label: 'Twitter / X' },
  whitepaper: { key: 'whitepaper', icon: '📄', label: 'Whitepaper' },
  tokenomics: { key: 'tokenomics', icon: '🥧', label: 'Tokenomics' },
  security: { key: 'security', icon: '🛡', label: 'Security / audit' },
  community: { key: 'community', icon: '👥', label: 'Community' },
  chart: { key: 'chart', icon: '📈', label: 'Chart' },
  buy: { key: 'buy', icon: '🟢', label: 'Buy' },
};

const ALL_ORDER: SingleTopic[] = ['website', 'twitter', 'community', 'chart', 'tokenomics', 'whitepaper', 'security', 'buy'];

function rawUrl(topic: SingleTopic, i: LinkReplyInput): string | null {
  const t = i.token;
  switch (topic) {
    case 'website': return t.websiteUrl;
    case 'twitter': return t.twitterUrl;
    case 'whitepaper': return t.whitepaperUrl;
    case 'tokenomics': return t.tokenomicsUrl;
    case 'security': return t.securityUrl;
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
 * Builds the group reply (Telegram HTML) for a link request, or null when there is nothing to say.
 * Respects the admin's button on/off switches and never shows a link that fails URL validation.
 */
export function buildLinkReply(input: LinkReplyInput): string | null {
  const enabled = (key: ButtonKey) => input.buttons.find((b) => b.key === key)?.enabled ?? true;
  const asked = input.topics.includes('all');
  const topics: SingleTopic[] = asked ? ALL_ORDER : (input.topics as SingleTopic[]);

  const lines: string[] = [];
  for (const topic of topics) {
    const { key, icon, label } = META[topic];
    if (!enabled(key)) continue;
    const url = resolveUrl(topic, input);
    if (url) {
      lines.push(`${icon} <b>${label}:</b> ${escapeHtml(url)}`);
    } else if (!asked) {
      // Asked for this one specifically: say honestly why there is no link.
      lines.push(
        topic === 'buy' && input.token.launchStatus !== 'TRADING_LIVE'
          ? `${icon} <b>${label}:</b> trading has not been announced as live yet. Please wait for an official announcement.`
          : `${icon} <b>${label}:</b> not available yet.`,
      );
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}
