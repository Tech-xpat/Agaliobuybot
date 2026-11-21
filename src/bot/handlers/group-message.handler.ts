import { GrammyError, HttpError, type Bot, type Context } from 'grammy';
import { isInfoRequest } from '../../detection/keyword-detector';
import { processMessage } from '../../detection/message-processor';
import { errMessage, telegramRetryAfter } from '../../utils/errors';
import { startsWithCommand } from '../filters';
import type { BotDeps } from '../context';

export function registerGroupMessageHandler(bot: Bot, deps: BotDeps): void {
  bot.on(['message:text', 'message:caption', 'edited_message:text', 'edited_message:caption'], async (ctx, next) => {
    const msg = ctx.msg;
    if (!msg || !ctx.chat || ctx.chat.type === 'private') return next();
    if (startsWithCommand(msg)) return next();

    const text = msg.text ?? msg.caption ?? '';
    // Anonymous group admins appear as a bot-flagged sender with sender_chat set: allow those.
    const fromBot = ctx.from?.is_bot === true && !msg.sender_chat;

    // Plain "ca" / "wen ca" / "contract address" requests get the token card (no slash command needed).
    if (isInfoRequest(text)) {
      await answerInfoRequest(ctx, deps, msg.message_id);
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
    await deps.announcements.publish(ctx.api, { chatId: chat.id, chatIdBig: BigInt(chat.id), replyTo: messageId, kind: 'AUTO' });
  } catch (err) {
    deps.log.error({ err: errMessage(err) }, 'Failed to answer a contract request');
    await deps.repos.audit.event('error', 'info-request.failed', errMessage(err));
  }
}
