import type { Bot } from 'grammy';
import { isInfoRequest } from '../../detection/keyword-detector';
import { startsWithCommand } from '../filters';
import type { AdminPanel } from '../panel/admin-panel';
import type { BotDeps } from '../context';

/**
 * Private chats:
 *  1. an admin with a pending prompt (typing a URL, address, …) → handled by the panel
 *  2. "ca" style requests from anyone → token card
 *  3. any other message from an admin → open the admin panel
 */
export function registerPrivateMessageHandler(bot: Bot, deps: BotDeps, panel: AdminPanel): void {
  bot.on(['message:text', 'message:photo'], async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.msg.text ?? ctx.msg.caption ?? '';
    if (text && startsWithCommand(ctx.msg)) return next();

    if (await panel.handleInput(ctx)) return;

    if (text && isInfoRequest(text)) {
      const built = await deps.announcements.build('AUTO');
      if (!built) return void (await ctx.reply('The official AGALIO contract has not been announced yet.'));
      await deps.announcements.send(ctx.api, ctx.chat.id, built);
      return;
    }

    if (ctx.from && (await deps.guard.isAdmin(BigInt(ctx.from.id)))) await panel.open(ctx);
  });
}
