import type { Bot, Context } from 'grammy';
import { buildCopyContractHtml } from '../../announcements/announcement.builder';
import { isTelegramMessageGone } from '../../utils/errors';
import { CALLBACK_COPY, CALLBACK_DETAILS } from '../../types';
import type { BotDeps } from '../context';

async function answer(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text ? { text } : undefined);
  } catch (err) {
    if (!isTelegramMessageGone(err)) throw err; // expired queries are normal
  }
}

export function registerCallbackHandlers(bot: Bot, deps: BotDeps): void {
  /** Shared guard: duplicate-delivery protection + per-chat cooldown so buttons cannot spam the group. */
  async function gate(ctx: Context, action: string, cooldownSeconds: number): Promise<'go' | 'cooldown' | 'dup'> {
    const queryId = ctx.callbackQuery?.id;
    if (queryId && !(await deps.cache.setNx(`cb:${queryId}`, 300))) return 'dup';
    const chat = ctx.chat?.id ?? 0;
    if (!(await deps.cache.setNx(`cbchat:${chat}:${action}`, cooldownSeconds))) return 'cooldown';
    return 'go';
  }

  bot.callbackQuery(CALLBACK_COPY, async (ctx) => {
    const g = await gate(ctx, 'copy', 20);
    if (g === 'dup') return answer(ctx);
    if (g === 'cooldown') return answer(ctx, 'The contract was just posted below. Tap it to copy.');

    // Always read the CURRENT official contract from the database. Never from callback data.
    const official = await deps.repos.tokens.getOfficial();
    if (!official?.contract) return answer(ctx, 'The official contract has not been set yet.');
    await answer(ctx, 'Contract posted below. Tap it to copy.');
    await ctx.reply(buildCopyContractHtml(official.contract.checksum), {
      parse_mode: 'HTML',
      reply_parameters: ctx.callbackQuery.message ? { message_id: ctx.callbackQuery.message.message_id, allow_sending_without_reply: true } : undefined,
      link_preview_options: { is_disabled: true },
    });
  });

  bot.callbackQuery(CALLBACK_DETAILS, async (ctx) => {
    const g = await gate(ctx, 'details', 30);
    if (g === 'dup') return answer(ctx);
    if (g === 'cooldown') return answer(ctx, 'Details were just posted below.');

    const html = await deps.announcements.buildDetails();
    if (!html) return answer(ctx, 'The official contract has not been set yet.');
    await answer(ctx, 'Details posted below.');
    await ctx.reply(html, {
      parse_mode: 'HTML',
      reply_parameters: ctx.callbackQuery.message ? { message_id: ctx.callbackQuery.message.message_id, allow_sending_without_reply: true } : undefined,
      link_preview_options: { is_disabled: true },
    });
  });

  // Anything else (old keyboards, tampered data): acknowledge and do nothing.
  bot.on('callback_query:data', async (ctx) => answer(ctx));
}
