import type { Bot } from 'grammy';
import { buildContractOnlyHtml } from '../../announcements/announcement.builder';
import { isInfoRequest } from '../../detection/keyword-detector';
import { detectStatRequest } from '../../detection/stat-keyword-detector';
import { startsWithCommand } from '../filters';
import type { AdminPanel } from '../panel/admin-panel';
import type { BotDeps } from '../context';
import { buildStatReplyFor } from './stat-request';

/**
 * Private chats:
 *  1. an admin with a pending prompt (typing a URL, address, …) → handled by the panel
 *  2. "ca" style requests from anyone → the contract address only; "price", "mc", … → just that stat
 *  3. any other message from an admin → open the admin panel
 */
export function registerPrivateMessageHandler(bot: Bot, deps: BotDeps, panel: AdminPanel): void {
  bot.on(['message:text', 'message:photo'], async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.msg.text ?? ctx.msg.caption ?? '';
    if (text && startsWithCommand(ctx.msg)) return next();

    if (await panel.handleInput(ctx)) return;

    if (text && isInfoRequest(text)) {
      const official = await deps.repos.tokens.getOfficial();
      if (!official?.contract) return void (await ctx.reply('The official AGALIO contract has not been announced yet.'));
      await ctx.reply(buildContractOnlyHtml(official.contract.checksum), { parse_mode: 'HTML' });
      return;
    }

    const statTopics = text ? detectStatRequest(text) : [];
    if (statTopics.length > 0) {
      const html = await buildStatReplyFor(deps, statTopics);
      if (!html) return void (await ctx.reply('The official AGALIO contract has not been announced yet.'));
      await ctx.reply(html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      return;
    }

    if (ctx.from && (await deps.guard.isAdmin(BigInt(ctx.from.id)))) await panel.open(ctx);
  });
}
