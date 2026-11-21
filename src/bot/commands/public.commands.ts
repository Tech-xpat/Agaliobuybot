import { InlineKeyboard, type Bot } from 'grammy';
import { DEFAULT_BUTTON_LABELS } from '../../config/constants';
import { safeUrl } from '../../services/url.service';
import { buildCopyContractHtml } from '../../announcements/announcement.builder';
import { helpText, startText } from '../messages/texts';
import { isPrivateChat, userIdOf } from '../filters';
import type { BotDeps } from '../context';
import type { AdminPanel } from '../panel/admin-panel';

export function registerPublicCommands(bot: Bot, deps: BotDeps, panel: AdminPanel): void {
  const quiet = (ctx: { chat?: { id: number } }, name: string, seconds: number) =>
    deps.cache.setNx(`cmd:${ctx.chat?.id ?? 0}:${name}`, seconds);

  bot.command('start', async (ctx) => {
    if (isPrivateChat(ctx) && (await deps.guard.isAdmin(userIdOf(ctx)))) {
      await panel.open(ctx);
      return;
    }
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

  bot.command('tutorial', async (ctx) => {
    if (!isPrivateChat(ctx) && !(await quiet(ctx, 'tutorial', 30))) return;
    const official = await deps.repos.tokens.getOfficial();
    const url = safeUrl(official?.token.tutorialUrl);
    const enabled = official ? ((await deps.repos.tokens.getButtonSettings(official.token.id)).find((b) => b.key === 'tutorial')?.enabled ?? true) : false;
    if (!url || !enabled) {
      await ctx.reply('Video tutorials are not available yet.');
      return;
    }
    await ctx.reply('🎓 <b>Tap the button to watch the video tutorials</b> 👇', {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().url(DEFAULT_BUTTON_LABELS.tutorial, url),
      link_preview_options: { is_disabled: true },
    });
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
