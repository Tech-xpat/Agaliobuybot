import { GrammyError, HttpError, type Bot, type Context } from 'grammy';
import { buildContractOnlyHtml } from '../../announcements/announcement.builder';
import { buildLinkReply } from '../../announcements/link-reply';
import { isInfoRequest } from '../../detection/keyword-detector';
import { detectLinkRequest, type LinkTopic } from '../../detection/link-keyword-detector';
import { detectStatRequest, type StatTopic } from '../../detection/stat-keyword-detector';
import { processMessage } from '../../detection/message-processor';
import { errMessage, telegramRetryAfter } from '../../utils/errors';
import { startsWithCommand } from '../filters';
import { toInlineKeyboard } from '../keyboards/announcement.keyboard';
import type { BotDeps } from '../context';
import { buildStatReplyFor } from './stat-request';

export function registerGroupMessageHandler(bot: Bot, deps: BotDeps): void {
  bot.on(['message:text', 'message:caption', 'edited_message:text', 'edited_message:caption'], async (ctx, next) => {
    const msg = ctx.msg;
    if (!msg || !ctx.chat || ctx.chat.type === 'private') return next();
    if (startsWithCommand(msg)) return next();

    const text = msg.text ?? msg.caption ?? '';
    // Anonymous group admins appear as a bot-flagged sender with sender_chat set: allow those.
    const fromBot = ctx.from?.is_bot === true && !msg.sender_chat;

    // Plain "ca" / "wen ca" / "contract address" requests get the contract address only (no slash command needed).
    if (isInfoRequest(text)) {
      await answerInfoRequest(ctx, deps, msg.message_id);
      return;
    }

    // Plain "website" / "twitter or x" / "whitepaper" / "tokenomics" requests get the matching link.
    const linkTopics = detectLinkRequest(text);
    if (linkTopics.length > 0) {
      await answerLinkRequest(ctx, deps, msg.message_id, linkTopics);
      return;
    }

    // Plain "price" / "mc" / "liquidity" / "holders" / "supply" requests get just that number.
    const statTopics = detectStatRequest(text);
    if (statTopics.length > 0) {
      await answerStatRequest(ctx, deps, msg.message_id, statTopics);
      return;
    }

    const decision = await processMessage(
      {
        chatId: BigInt(ctx.chat.id),
        messageId: msg.message_id,
        userId: ctx.from ? BigInt(ctx.from.id) : null,
        text,
        isForward: msg.forward_origin !== undefined,
        fromBot,
      },
      {
        configuredChatId: BigInt(deps.env.TELEGRAM_GROUP_ID),
        cache: deps.cache,
        log: deps.log,
        getSettings: async () => {
          const cfg = await deps.repos.config.get();
          return { enabled: cfg.announcementEnabled, paused: cfg.paused, cooldownSeconds: cfg.cooldownSeconds };
        },
        getOfficial: async () => {
          const o = await deps.repos.tokens.getOfficial();
          return o?.contract ? { tokenId: o.token.id, contractLower: o.contract.address } : null;
        },
        ensureGroup: (chatId) => deps.repos.groups.ensure(chatId, 'title' in ctx.chat! ? ctx.chat!.title : null),
        recordDetection: (input) => deps.repos.announcements.tryRecordDetection({ ...input, matched: true }),
      },
    );

    if (decision.action === 'ignore') {
      deps.log.debug({ reason: decision.reason }, 'Message ignored');
      return;
    }

    try {
      await deps.announcements.publish(ctx.api, {
        chatId: ctx.chat.id,
        chatIdBig: BigInt(ctx.chat.id),
        replyTo: msg.message_id,
        kind: 'AUTO',
      });
      deps.log.info({ messageId: msg.message_id }, 'Official contract detected, announcement posted');
    } catch (err) {
      const retryAfter = telegramRetryAfter(err);
      const transient = retryAfter !== undefined || err instanceof HttpError || (err instanceof GrammyError && err.error_code >= 500);
      deps.log.error({ err: errMessage(err), transient }, 'Failed to post announcement');
      await deps.repos.audit.event('error', 'announcement.failed', errMessage(err), { messageId: msg.message_id });
      if (transient) {
        await deps.jobs.enqueueAnnounceRetry({ chatId: String(ctx.chat.id), replyTo: msg.message_id, kind: 'AUTO' }, (retryAfter ?? 5) * 1000);
      }
    }
  });
}

async function answerInfoRequest(ctx: Context, deps: BotDeps, messageId: number): Promise<void> {
  const chat = ctx.chat!;
  if (String(chat.id) !== deps.env.TELEGRAM_GROUP_ID) return;
  if (ctx.from?.is_bot === true && !ctx.msg?.sender_chat) return;
  const cfg = await deps.repos.config.get();
  if (!cfg.announcementEnabled || cfg.paused) return;
  const official = await deps.repos.tokens.getOfficial();
  if (!official?.contract) return;

  // Anti-spam: once per message, once per user per minute, and once per chat per 30 seconds.
  const userId = ctx.from?.id ?? 0;
  if (!(await deps.cache.setNx(`kw:msg:${chat.id}:${messageId}`, 86_400))) return;
  if (!(await deps.cache.setNx(`kw:user:${chat.id}:${userId}`, 60))) return;
  if (!(await deps.cache.setNx(`kw:chat:${chat.id}`, 30))) return;

  try {
    // Just the address (tap to copy). Anything else (price, mc, links …) is answered when asked for individually.
    await ctx.reply(buildContractOnlyHtml(official.contract.checksum), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    });
  } catch (err) {
    deps.log.error({ err: errMessage(err) }, 'Failed to answer a contract request');
    await deps.repos.audit.event('error', 'info-request.failed', errMessage(err));
  }
}

/** Replies with only the stat(s) someone asked for ("price", "mc", "liquidity and volume"). */
async function answerStatRequest(ctx: Context, deps: BotDeps, messageId: number, topics: StatTopic[]): Promise<void> {
  const chat = ctx.chat!;
  if (String(chat.id) !== deps.env.TELEGRAM_GROUP_ID) return;
  if (ctx.from?.is_bot === true && !ctx.msg?.sender_chat) return;
  const cfg = await deps.repos.config.get();
  if (!cfg.announcementEnabled || cfg.paused) return;

  // Anti-spam: once per message, once per user per 20s, and the same request once per chat per 30s.
  const userId = ctx.from?.id ?? 0;
  if (!(await deps.cache.setNx(`kws:msg:${chat.id}:${messageId}`, 86_400))) return;
  if (!(await deps.cache.setNx(`kws:user:${chat.id}:${userId}`, 20))) return;
  if (!(await deps.cache.setNx(`kws:topics:${chat.id}:${topics.join('+')}`, 30))) return;

  try {
    const html = await buildStatReplyFor(deps, topics);
    if (!html) return;
    await ctx.reply(html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    });
  } catch (err) {
    deps.log.error({ err: errMessage(err), topics }, 'Failed to answer a stat request');
    await deps.repos.audit.event('error', 'stat-request.failed', errMessage(err));
  }
}

/** Replies with the project link(s) someone asked for ("website?", "wen whitepaper", "twitter or x"). */
async function answerLinkRequest(ctx: Context, deps: BotDeps, messageId: number, topics: LinkTopic[]): Promise<void> {
  const chat = ctx.chat!;
  if (String(chat.id) !== deps.env.TELEGRAM_GROUP_ID) return;
  if (ctx.from?.is_bot === true && !ctx.msg?.sender_chat) return;
  const cfg = await deps.repos.config.get();
  if (!cfg.announcementEnabled || cfg.paused) return;

  // Anti-spam: once per message, once per user per 20s, and the same request once per chat per minute.
  const userId = ctx.from?.id ?? 0;
  if (!(await deps.cache.setNx(`kwl:msg:${chat.id}:${messageId}`, 86_400))) return;
  if (!(await deps.cache.setNx(`kwl:user:${chat.id}:${userId}`, 20))) return;
  if (!(await deps.cache.setNx(`kwl:topics:${chat.id}:${topics.join('+')}`, 60))) return;

  try {
    const official = await deps.repos.tokens.getOfficial();
    if (!official) return;
    const { token, contract } = official;

    // The chart link falls back to the DexScreener pair when the admin set none (cached lookup).
    let marketChartUrl: string | null = null;
    if (contract && !token.chartUrl && (topics.includes('chart') || topics.includes('all'))) {
      try {
        marketChartUrl = (await deps.market.get(contract.checksum)).data?.chartUrl ?? null;
      } catch {
        marketChartUrl = null;
      }
    }

    const reply = buildLinkReply({
      topics,
      token: {
        launchStatus: token.launchStatus as Parameters<typeof buildLinkReply>[0]['token']['launchStatus'],
        buyUrl: token.buyUrl,
        chartUrl: token.chartUrl,
        communityUrl: token.communityUrl,
        websiteUrl: token.websiteUrl,
        twitterUrl: token.twitterUrl,
        whitepaperUrl: token.whitepaperUrl,
        tokenomicsUrl: token.tokenomicsUrl,
        securityUrl: token.securityUrl,
        tutorialUrl: token.tutorialUrl,
      },
      buttons: await deps.repos.tokens.getButtonSettings(token.id),
      contractChecksum: contract?.checksum ?? null,
      marketChartUrl,
    });
    if (!reply) return;

    await ctx.reply(reply.html, {
      parse_mode: 'HTML',
      // Links are tappable URL buttons, same style as the announcement buttons.
      ...(reply.rows.length > 0 ? { reply_markup: toInlineKeyboard(reply.rows) } : {}),
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    });
  } catch (err) {
    deps.log.error({ err, topics }, `Failed to answer a link request [${topics.join(',')}]: ${errMessage(err).slice(0, 300)}`);
    await deps.repos.audit.event('error', 'link-request.failed', errMessage(err));
  }
}
