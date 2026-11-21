export const BSC_CHAIN_ID = 56;
export const CHAIN_NAME = 'BNB Smart Chain (BSC)';
export const DEXSCREENER_CHAIN_ID = 'bsc';
export const UNAVAILABLE = 'Data currently unavailable';

export const LAUNCH_STATUSES = [
  'PRE_LAUNCH',
  'CONTRACT_DEPLOYED',
  'TRADING_NOT_LIVE',
  'TRADING_LIVE',
  'PAUSED',
  'ANNOUNCEMENT_ONLY',
] as const;
export type LaunchStatusValue = (typeof LAUNCH_STATUSES)[number];

export const LAUNCH_STATUS_LABELS: Record<LaunchStatusValue, string> = {
  PRE_LAUNCH: 'PRE-LAUNCH',
  CONTRACT_DEPLOYED: 'CONTRACT DEPLOYED',
  TRADING_NOT_LIVE: 'TRADING NOT YET LIVE',
  TRADING_LIVE: 'TRADING LIVE',
  PAUSED: 'PAUSED',
  ANNOUNCEMENT_ONLY: 'ANNOUNCEMENT ONLY',
};

export const LAUNCH_STATUS_NOTES: Record<LaunchStatusValue, string> = {
  PRE_LAUNCH: 'The token has not launched yet. Nothing here is a trading signal.',
  CONTRACT_DEPLOYED: 'The contract has been deployed. Trading has not been announced as live.',
  TRADING_NOT_LIVE: 'Trading is not live yet. Wait for an official announcement.',
  TRADING_LIVE: 'Trading has been announced as live by the AGALIO admins.',
  PAUSED: 'The launch is currently paused. Wait for an official announcement.',
  ANNOUNCEMENT_ONLY: 'Information only. No trading link is being promoted.',
};

export const BUTTON_KEYS = [
  'buy',
  'chart',
  'copy',
  'details',
  'community',
  'bscscan',
  'website',
  'twitter',
  'telegram',
  'tokenomics',
  'whitepaper',
  'security',
  'tutorial',
] as const;
export type ButtonKey = (typeof BUTTON_KEYS)[number];

export const DEFAULT_BUTTON_LABELS: Record<ButtonKey, string> = {
  buy: '🟢 BUY AGALIO',
  chart: '📈 LIVE CHART',
  copy: '📋 COPY CONTRACT',
  details: 'ℹ️ TOKEN DETAILS',
  community: '👥 HOLDERS / COMMUNITY',
  bscscan: '🔍 BSC SCAN',
  website: '🌐 Website',
  twitter: '𝕏 Twitter',
  telegram: '💬 Telegram',
  tokenomics: '🥧 Tokenomics',
  whitepaper: '📄 Whitepaper',
  security: '🛡 Security Info',
  tutorial: '🎓 VIDEO TUTORIALS',
};

/** Token URL fields an admin can set, mapped to the button that uses them. */
export const URL_FIELDS = [
  'buyUrl',
  'chartUrl',
  'communityUrl',
  'websiteUrl',
  'twitterUrl',
  'whitepaperUrl',
  'tokenomicsUrl',
  'securityUrl',
  'tutorialUrl',
] as const;
export type UrlField = (typeof URL_FIELDS)[number];

export const EXTRA_LINK_FIELDS: Record<string, UrlField> = {
  twitter: 'twitterUrl',
  x: 'twitterUrl',
  whitepaper: 'whitepaperUrl',
  tokenomics: 'tokenomicsUrl',
  security: 'securityUrl',
  tutorial: 'tutorialUrl',
  tutorials: 'tutorialUrl',
  video: 'tutorialUrl',
};

// Optional on-chain pair discovery (informational only; never used to build the Buy URL).
// PancakeSwap V2 factory and WBNB on BSC. Verify on BscScan before relying on them.
export const PANCAKE_V2_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
export const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;
export const MAX_DESCRIPTION_LENGTH = 800;
export const MAX_TEMPLATE_LENGTH = 3000;
