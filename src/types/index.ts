import type { ButtonKey, LaunchStatusValue } from '../config/constants';
import type { OnChainTokenData } from '../blockchain/contract.service';
import type { MarketResult } from '../market-data/market.provider';

export interface TokenView {
  name: string;
  symbol: string;
  description: string;
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

export interface ButtonSetting {
  key: ButtonKey;
  enabled: boolean;
  label?: string | null;
}

export type AnnouncementKind = 'AUTO' | 'TEST' | 'PREVIEW';

export interface AnnouncementContext {
  token: TokenView;
  contract: { checksum: string; lower: string };
  onchain: OnChainTokenData | null;
  market: MarketResult;
  buttons: ButtonSetting[];
  template: string | null;
  kind: AnnouncementKind;
  bscscanBaseUrl: string;
  telegramGroupUrl: string;
}

export type ButtonSpec =
  | { kind: 'url'; key: ButtonKey; text: string; url: string }
  | { kind: 'callback'; key: ButtonKey; text: string; data: string };

export const CALLBACK_COPY = 'c:copy';
export const CALLBACK_DETAILS = 'c:details';
