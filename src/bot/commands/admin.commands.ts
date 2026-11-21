import type { Bot, Context } from 'grammy';
import { LAUNCH_STATUS_LABELS, type LaunchStatusValue, type UrlField } from '../../config/constants';
import { AppError, toUserMessage } from '../../utils/errors';
import { escapeHtml } from '../../utils/sanitizers';
import { helpText } from '../messages/texts';
import { buildStatusHtml } from '../messages/status';
import { isPrivateChat, userIdOf } from '../filters';
import type { BotDeps } from '../context';

type AdminHandler = (ctx: Context, args: string, actor: bigint) => Promise<void>;

export function registerAdminCommands(bot: Bot, deps: BotDeps): void {
  const { adminService: admin, repos, guard } = deps;

  /** Wraps every admin command: ID-based authorization, private-chat only, safe error replies. */
  const guarded =
    (name: string, handler: AdminHandler) =>
    async (ctx: Context): Promise<void> => {
      const actor = userIdOf(ctx);
      if (!(await guard.isAdmin(actor))) {
        // Silent in groups so non-admins cannot probe; explicit in private.
        if (isPrivateChat(ctx)) await ctx.reply('⛔ You are not authorized to use this command.');
        deps.log.info({ command: name, userId: actor?.toString() }, 'Unauthorized admin command attempt');
        return;
      }
      if (!isPrivateChat(ctx)) {
        await ctx.reply('🔒 Please use admin commands in a private chat with me.');
        return;
      }
      try {
        await handler(ctx, typeof ctx.match === 'string' ? ctx.match.trim() : '', actor as bigint);
      } catch (err) {
        if (!(err instanceof AppError && err.userSafe)) deps.log.error({ err, command: name }, 'Admin command failed');
        await ctx.reply(`❌ ${escapeHtml(toUserMessage(err))}`, { parse_mode: 'HTML' });
      }
    };

  const reply = (ctx: Context, html: string) => ctx.reply(html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  const warn = (w: string[]) => (w.length ? `\n⚠️ ${w.map(escapeHtml).join('\n⚠️ ')}` : '');

  bot.command('adminhelp', guarded('adminhelp', async (ctx) => void (await reply(ctx, helpText(true)))));

  bot.command(
    'setcontract',
    guarded('setcontract', async (ctx, args, actor) => {
      const [addr, ...flags] = args.split(/\s+/).filter(Boolean);
      if (!addr) return void (await reply(ctx, 'Usage: <code>/setcontract 0x… [confirm] [force]</code>'));
      const lower = flags.map((f) => f.toLowerCase());
      const res = await admin.setContract(actor, addr, { confirm: lower.includes('confirm'), force: lower.includes('force') });
      await reply(
        ctx,
        `✅ Official contract set:\n<code>${escapeHtml(res.checksum)}</code>${res.replaced ? '\n(replaced the previous contract)' : ''}${res.hasCode ? '' : '\n⚠️ No code found on-chain yet (forced).'}`,
      );
    }),
  );

  const urlCommand = (command: string, field: UrlField, label: string) =>
    bot.command(
      command,
      guarded(command, async (ctx, args, actor) => {
        if (!args) return void (await reply(ctx, `Usage: <code>/${command} https://…</code> or <code>/${command} clear</code>`));
        const res = await admin.setUrl(actor, field, args);
        await reply(ctx, res.value ? `✅ ${label} set to ${escapeHtml(res.value)}${warn(res.warnings)}` : `✅ ${label} cleared.`);
      }),
    );
  urlCommand('setbuyurl', 'buyUrl', 'Buy URL');
  urlCommand('setcharturl', 'chartUrl', 'Chart URL');
  urlCommand('setcommunity', 'communityUrl', 'Community URL');
  urlCommand('setwebsite', 'websiteUrl', 'Website URL');

  bot.command(
    'setlink',
    guarded('setlink', async (ctx, args, actor) => {
      const [name, ...rest] = args.split(/\s+/).filter(Boolean);
      if (!name || rest.length === 0) return void (await reply(ctx, 'Usage: <code>/setlink twitter|whitepaper|tokenomics|security|tutorial https://…|clear</code>'));
      const res = await admin.setLink(actor, name, rest.join(' '));
      await reply(ctx, res.value ? `✅ ${escapeHtml(name)} link set.` : `✅ ${escapeHtml(name)} link cleared.`);
    }),
  );

  bot.command(
    'setdescription',
    guarded('setdescription', async (ctx, args, actor) => {
      if (!args) return void (await reply(ctx, 'Usage: <code>/setdescription Your text…</code>'));
      const text = await admin.setDescription(actor, args);
      await reply(ctx, `✅ Description saved (${text.length} chars).`);
    }),
  );

  bot.command(
    'setlaunchstatus',
    guarded('setlaunchstatus', async (ctx, args, actor) => {
      if (!args) {
        const t = await repos.tokens.getToken();
        return void (await reply(ctx, `Current: <b>${t ? LAUNCH_STATUS_LABELS[t.launchStatus as LaunchStatusValue] : '?'}</b>\nUsage: <code>/setlaunchstatus TRADING_LIVE</code>\nOptions: ${Object.keys(LAUNCH_STATUS_LABELS).join(', ')}`));
      }
      const res = await admin.setLaunchStatus(actor, args);
      await reply(ctx, `✅ Launch status: <b>${LAUNCH_STATUS_LABELS[res.status]}</b>${warn(res.warnings)}`);
    }),
  );

  bot.command(
    'setlogo',
    guarded('setlogo', async (ctx, args, actor) => {
      const photos = ctx.msg?.photo ?? ctx.msg?.reply_to_message?.photo;
      if (/^clear$/i.test(args)) {
        await admin.setLogo(actor, { clear: true });
        return void (await reply(ctx, '✅ Logo cleared.'));
      }
      if (photos && photos.length > 0) {
        await admin.setLogo(actor, { fileId: photos[photos.length - 1]!.file_id });
        return void (await reply(ctx, '✅ Logo updated from the photo.'));
      }
      if (args) {
        await admin.setLogo(actor, { url: args });
        return void (await reply(ctx, '✅ Logo URL saved.'));
      }
      await reply(ctx, 'Reply to a photo with <code>/setlogo</code>, send a photo with the caption <code>/setlogo</code>, or use <code>/setlogo https://…</code> / <code>/setlogo clear</code>.');
    }),
  );

  bot.command(
    'buttons',
    guarded('buttons', async (ctx, args, actor) => {
      const token = await repos.tokens.getToken();
      if (!token) return;
      const [key, state] = args.split(/\s+/).filter(Boolean);
      if (key && state && /^(on|off)$/i.test(state)) {
        const k = await admin.setButton(actor, key, state.toLowerCase() === 'on');
        return void (await reply(ctx, `✅ Button <b>${k}</b> is now ${state.toLowerCase()}.`));
      }
      const settings = await repos.tokens.getButtonSettings(token.id);
      await reply(ctx, `<b>Buttons</b>\n${settings.map((s) => `${s.enabled ? '🟢' : '⚪️'} ${s.key}`).join('\n')}\n\nUsage: <code>/buttons buy off</code>\nA button also needs a working destination to appear.`);
    }),
  );

  bot.command('pause', guarded('pause', async (ctx, _a, actor) => { await admin.setPaused(actor, true); await reply(ctx, '⏸ Automatic announcements are paused.'); }));
  bot.command('resume', guarded('resume', async (ctx, _a, actor) => { await admin.setPaused(actor, false); await reply(ctx, '▶️ Automatic announcements resumed.'); }));

  bot.command(
    'settemplate',
    guarded('settemplate', async (ctx, _args, actor) => {
      // Take the raw text after the command so newlines are preserved.
      const raw = (ctx.msg?.text ?? '').replace(/^\/settemplate(@\w+)?\s*/i, '');
      if (!raw) {
        return void (await reply(ctx, 'Send <code>/settemplate</code> followed by your Telegram-HTML template. Placeholders look like <code>{{name}}</code>. Use /resettemplate to restore the default.'));
      }
      await admin.setTemplate(actor, raw);
      await reply(ctx, '✅ Template saved. Use /announcement to preview it.');
    }),
  );
  bot.command('resettemplate', guarded('resettemplate', async (ctx, _a, actor) => { await admin.setTemplate(actor, null); await reply(ctx, '✅ Default template restored.'); }));

  bot.command(
    'announcement',
    guarded('announcement', async (ctx) => {
      const built = await deps.announcements.build('PREVIEW', { forceRefresh: true });
      if (!built) return void (await reply(ctx, 'No official contract is set. Use /setcontract first.'));
      await deps.announcements.send(ctx.api, ctx.chat!.id, built);
    }),
  );

  bot.command(
    'test',
    guarded('test', async (ctx, _a, actor) => {
      const chatId = deps.env.TELEGRAM_GROUP_ID;
      const res = await deps.announcements.publish(ctx.api, { chatId, chatIdBig: BigInt(chatId), kind: 'TEST' });
      if (!res) return void (await reply(ctx, 'No official contract is set. Use /setcontract first.'));
      await repos.audit.audit(actor, 'announcement.test', { messageId: res.messageId });
      await reply(ctx, '✅ TEST announcement posted in the group.');
    }),
  );

  bot.command(
    'refresh',
    guarded('refresh', async (ctx, _a, actor) => {
      const official = await repos.tokens.getOfficial();
      if (!official?.contract) return void (await reply(ctx, 'No official contract is set.'));
      const [onchain, market] = await Promise.all([
        deps.tokenSvc.getOnChain(official.contract.checksum, { force: true }),
        deps.market.get(official.contract.checksum, { force: true }),
      ]);
      await repos.audit.audit(actor, 'data.refresh');
      await reply(ctx, `🔄 Refreshed.\nOn-chain: ${onchain ? (onchain.hasCode ? 'ok' : 'no code at address') : 'unavailable'}\nMarket: ${market.status}${market.stale ? ' (stale)' : ''}`);
    }),
  );

  bot.command('status', guarded('status', async (ctx) => void (await reply(ctx, await buildStatusHtml(deps)))));

  bot.command(
    'admins',
    guarded('admins', async (ctx) => {
      const rows = await repos.admins.list();
      const env = deps.env.TELEGRAM_ADMIN_IDS.map((i) => `• ${i} (primary)`);
      await reply(ctx, `<b>Administrators</b>\n${[...env, ...rows.map((r) => `• ${r.telegramId}`)].join('\n')}`);
    }),
  );
  bot.command('addadmin', guarded('addadmin', async (ctx, args, actor) => { const id = await admin.addAdmin(actor, args); await reply(ctx, `✅ Added admin ${id}.`); }));
  bot.command('removeadmin', guarded('removeadmin', async (ctx, args, actor) => { const ok = await admin.removeAdmin(actor, args); await reply(ctx, ok ? '✅ Admin removed.' : 'That user was not an admin.'); }));

}
