import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { InputFile, type Api } from 'grammy';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { LaunchStatusValue } from '../config/constants';
import { TELEGRAM_CAPTION_LIMIT } from '../config/constants';
import type { TokenService } from '../blockchain/token.service';
import type { MarketService } from '../market-data/market.service';
import type { Repositories } from '../database/repositories';
import { buildButtonSpecs, toInlineKeyboard } from '../bot/keyboards/announcement.keyboard';
import type { AnnouncementContext, AnnouncementKind, ButtonSpec } from '../types';
import { errMessage } from '../utils/errors';
import { buildAnnouncementHtml, buildDetailsHtml } from './announcement.builder';

export interface AnnouncementServiceDeps {
  repos: Repositories;
  tokenSvc: TokenService;
  market: MarketService;
  env: Env;
  log: Logger;
}

export interface PublishOptions {
  chatId: number | string;
  chatIdBig: bigint;
  replyTo?: number;
  kind: Exclude<AnnouncementKind, 'PREVIEW'>;
}

export interface BuiltAnnouncement {
  html: string;
  rows: ButtonSpec[][];
  ctx: AnnouncementContext;
}

export class AnnouncementService {
  constructor(private readonly d: AnnouncementServiceDeps) {}

  async buildContext(kind: AnnouncementKind, opts: { forceRefresh?: boolean } = {}): Promise<AnnouncementContext | null> {
    const { repos, tokenSvc, market, env } = this.d;
    const official = await repos.tokens.getOfficial();
    if (!official || !official.contract) return null;
    const { token, contract } = official;
    const [onchain, marketResult, buttons, cfg] = await Promise.all([
      tokenSvc.getOnChain(contract.checksum, { force: opts.forceRefresh }),
      market.get(contract.checksum, { force: opts.forceRefresh }),
      repos.tokens.getButtonSettings(token.id),
      repos.config.get(),
    ]);
    return {
      token: {
        name: token.name,
        symbol: token.symbol,
        description: token.description,
        launchStatus: token.launchStatus as LaunchStatusValue,
        buyUrl: token.buyUrl,
        chartUrl: token.chartUrl,
        communityUrl: token.communityUrl,
        websiteUrl: token.websiteUrl,
        twitterUrl: token.twitterUrl,
        whitepaperUrl: token.whitepaperUrl,
        tokenomicsUrl: token.tokenomicsUrl,
        securityUrl: token.securityUrl,
      },
      contract: { checksum: contract.checksum, lower: contract.address },
      onchain,
      market: marketResult,
      buttons,
      template: cfg.announcementTemplate,
      kind,
      bscscanBaseUrl: env.BSCSCAN_BASE_URL,
      telegramGroupUrl: env.TELEGRAM_GROUP_URL,
    };
  }

  async build(kind: AnnouncementKind, opts: { forceRefresh?: boolean } = {}): Promise<BuiltAnnouncement | null> {
    const ctx = await this.buildContext(kind, opts);
    if (!ctx) return null;
    return { ctx, html: buildAnnouncementHtml(ctx), rows: buildButtonSpecs(ctx) };
  }

  async buildDetails(): Promise<string | null> {
    const ctx = await this.buildContext('AUTO');
    return ctx ? buildDetailsHtml(ctx) : null;
  }

  /** Sends the announcement. Throws on Telegram failure so the caller can schedule a retry. */
  async publish(api: Api, opts: PublishOptions): Promise<{ messageId: number } | null> {
    const built = await this.build(opts.kind);
    if (!built) return null;
    const messageId = await this.send(api, opts.chatId, built, opts.replyTo);

    try {
      const official = await this.d.repos.tokens.getOfficial();
      const group = await this.d.repos.groups.ensure(opts.chatIdBig);
      if (official) {
        await this.d.repos.announcements.record({
          tokenId: official.token.id,
          groupId: group.id,
          triggerMsgId: opts.replyTo ?? null,
          telegramMessageId: messageId,
          contract: built.ctx.contract.lower,
          kind: opts.kind,
        });
      }
    } catch (err) {
      this.d.log.error({ err }, 'Announcement sent but could not be recorded');
    }
    return { messageId };
  }

  /** Sends a built card (logo + text + buttons) to any chat: announcements, previews, buy alerts. */
  async send(api: Api, chatId: number | string, built: Pick<BuiltAnnouncement, 'html' | 'rows'>, replyTo?: number): Promise<number> {
    const keyboard = toInlineKeyboard(built.rows);
    const reply_parameters = replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined;
    const logo = await this.resolveLogo();

    if (logo) {
      try {
        if (built.html.length <= TELEGRAM_CAPTION_LIMIT) {
          const msg = await api.sendPhoto(chatId, logo.media, { caption: built.html, parse_mode: 'HTML', reply_markup: keyboard, reply_parameters });
          await this.rememberFileId(logo, msg.photo);
          return msg.message_id;
        }
        const photo = await api.sendPhoto(chatId, logo.media, { reply_parameters });
        await this.rememberFileId(logo, photo.photo);
        const msg = await api.sendMessage(chatId, built.html, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
        return msg.message_id;
      } catch (err) {
        this.d.log.warn({ err: errMessage(err) }, 'Logo send failed, falling back to text announcement');
        if (/wrong file identifier|failed to get HTTP URL content/i.test(errMessage(err))) {
          const official = await this.d.repos.tokens.getToken();
          if (official) await this.d.repos.tokens.update(official.id, { logoFileId: null });
        }
      }
    }
    const msg = await api.sendMessage(chatId, built.html, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
      reply_parameters,
    });
    return msg.message_id;
  }

  private async resolveLogo(): Promise<{ media: string | InputFile; source: 'file_id' | 'url' | 'local' } | null> {
    const token = await this.d.repos.tokens.getToken();
    if (!token) return null;
    if (token.logoFileId) return { media: token.logoFileId, source: 'file_id' };
    if (token.logoPath?.startsWith('https://')) return { media: token.logoPath, source: 'url' };
    const local = resolve(process.cwd(), token.logoPath ?? this.d.env.AGALIO_LOGO_PATH);
    if (existsSync(local)) return { media: new InputFile(local), source: 'local' };
    return null;
  }

  private async rememberFileId(logo: { source: string }, photo: { file_id: string }[] | undefined): Promise<void> {
    if (logo.source !== 'local' || !photo || photo.length === 0) return;
    const fileId = photo[photo.length - 1]!.file_id;
    const token = await this.d.repos.tokens.getToken();
    if (token) await this.d.repos.tokens.update(token.id, { logoFileId: fileId });
  }
}
