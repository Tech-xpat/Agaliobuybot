import type { Bot } from 'grammy';
import { buildCopyContractHtml } from '../../announcements/announcement.builder';
import { helpText, startText } from '../messages/texts';
import { isPrivateChat, userIdOf } from '../filters';
import type { BotDeps } from '../context';

export function registerPublicCommands(bot: Bot, deps: BotDeps): void {
  const quiet = (ctx: { chat?: { id: number } }, name: string, seconds: number) =>
    deps.cache.setNx(`cmd:${ctx.chat?.id ?? 0}:${name}`, seconds);

  bot.command('start', async (ctx) => {
    if (!isPrivateChat(ctx) && !(await quiet(ctx, 'start', 60))) return;
    await ctx.reply(startText(), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  bot.command('help', async (ctx) => {
    const admin = isPrivateChat(ctx) && (await deps.guard.isAdmin(userIdOf(ctx)));
    if (!isPrivateChat(ctx) && !(await quiet(ctx, 'help', 60))) return;
    await ctx.reply(helpText(admin), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  bot.command('contract', async (ctx) => {
    if (!isPrivateChat(ctx) && !(await quiet(ctx, 'contract', 30))) return;
    const official = await deps.repos.tokens.getOfficial();
    if (!official?.contract) {
      await ctx.reply('The official AGALIO contract has not been announced yet.');
      return;
    }
    await ctx.reply(buildCopyContractHtml(official.contract.checksum), { parse_mode: 'HTML' });
  });

  bot.command('token', async (ctx) => {
    if (!isPrivateChat(ctx) && !(await quiet(ctx, 'token', 30))) return;
    const built = await deps.announcements.build('AUTO');
    if (!built) {
      await ctx.reply('The official AGALIO contract has not been announced yet.');
      return;
    }
    await deps.announcements.send(ctx.api, ctx.chat.id, built, ctx.msg.message_id);
  });
}
