import { InlineKeyboard, type Bot, type Context } from 'grammy';
import {
  BUTTON_KEYS,
  LAUNCH_STATUSES,
  LAUNCH_STATUS_LABELS,
  type LaunchStatusValue,
  type UrlField,
} from '../../config/constants';
import { TEMPLATE_KEYS } from '../../announcements/announcement.templates';
import { ContractConfirmationRequired, ContractNotDeployed } from '../../admin/admin.service';
import { AppError, isTelegramMessageGone, toUserMessage } from '../../utils/errors';
import { redactUrl } from '../../utils/formatters';
import { escapeHtml, truncate } from '../../utils/sanitizers';
import { isPrivateChat } from '../filters';
import { buildStatusHtml } from '../messages/status';
import type { BotDeps } from '../context';

/** Short callback codes for each editable link. */
const LINKS: Record<string, { field: UrlField; label: string; hint: string }> = {
  buy: { field: 'buyUrl', label: '🟢 Buy link', hint: 'Use {contract} where the token address goes, e.g. https://pancakeswap.finance/swap?chain=bsc&outputCurrency={contract}' },
  chart: { field: 'chartUrl', label: '📈 Chart link', hint: 'Optional. If empty, the DexScreener pair link is used automatically once a pair exists.' },
  community: { field: 'communityUrl', label: '👥 Holders / community', hint: 'e.g. your holders channel link' },
  website: { field: 'websiteUrl', label: '🌐 Website', hint: '' },
  twitter: { field: 'twitterUrl', label: '𝕏 Twitter', hint: '' },
  whitepaper: { field: 'whitepaperUrl', label: '📄 Whitepaper', hint: '' },
  tokenomics: { field: 'tokenomicsUrl', label: '🥧 Tokenomics', hint: '' },
  security: { field: 'securityUrl', label: '🛡 Security info', hint: '' },
};

type AwaitState =
  | { kind: 'contract' }
  | { kind: 'url'; code: string }
  | { kind: 'description' }
  | { kind: 'logo' }
  | { kind: 'template' }
  | { kind: 'addadmin' }
  | { kind: 'rmadmin' };

const AWAIT_TTL = 600;

export interface AdminPanel {
  register(bot: Bot): void;
  open(ctx: Context): Promise<void>;
  /** Handles a private message if an admin has a pending prompt. Returns true if consumed. */
  handleInput(ctx: Context): Promise<boolean>;
}

export function createAdminPanel(deps: BotDeps): AdminPanel {
  const { adminService: admin, repos, guard, cache } = deps;
  const awaitKey = (id: bigint) => `admin:await:${id}`;
  const pendingKey = (id: bigint) => `admin:pending:${id}`;

  const menuButton = () => new InlineKeyboard().text('⬅️ Menu', 'a:menu');
  const cancelButton = () => new InlineKeyboard().text('✖️ Cancel', 'a:cancel');

  async function mainMenu(): Promise<{ text: string; kb: InlineKeyboard }> {
    const [token, cfg, official] = await Promise.all([repos.tokens.getToken(), repos.config.get(), repos.tokens.getOfficial()]);
    const contract = official?.contract?.checksum;
    const text = [
      '<b>🛠 AGALIO Admin Panel</b>',
      `Launch status: <b>${token ? LAUNCH_STATUS_LABELS[token.launchStatus as LaunchStatusValue] : '?'}</b>`,
      `Auto-announcements: <b>${cfg.paused ? '⏸ PAUSED' : '▶️ running'}</b>`,
      `Contract: ${contract ? `<code>${escapeHtml(contract)}</code>` : '<b>NOT SET</b>'}`,
    ].join('\n');
    const kb = new InlineKeyboard()
      .text('📊 Status', 'a:status').text('👁 Preview', 'a:preview').row()
      .text('📜 Contract', 'a:ct').text('🚦 Launch status', 'a:ls').row()
      .text('🔗 Links', 'a:lk').text('🔘 Buttons', 'a:bt').row()
      .text('📝 Description', 'a:ds').text('🖼 Logo', 'a:lg').row()
      .text('🧩 Template', 'a:tp').text('👥 Admins', 'a:ad').row()
      .text('🧪 Test post', 'a:test').text('🔄 Refresh data', 'a:refresh').row()
      .text(cfg.paused ? '▶️ Resume announcements' : '⏸ Pause announcements', 'a:pause');
    return { text, kb };
  }

  async function show(ctx: Context, text: string, kb: InlineKeyboard): Promise<void> {
    const opts = { parse_mode: 'HTML' as const, reply_markup: kb, link_preview_options: { is_disabled: true } };
    try {
      if (ctx.callbackQuery) await ctx.editMessageText(text, opts);
      else await ctx.reply(text, opts);
    } catch (err) {
      if (isTelegramMessageGone(err)) return; // "message is not modified" etc.
      throw err;
    }
  }

  async function showMenu(ctx: Context, note?: string): Promise<void> {
    const { text, kb } = await mainMenu();
    await show(ctx, note ? `${note}\n\n${text}` : text, kb);
  }

  async function open(ctx: Context): Promise<void> {
    const { text, kb } = await mainMenu();
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  async function setAwait(actor: bigint, state: AwaitState): Promise<void> {
    await cache.setJson(awaitKey(actor), state, AWAIT_TTL);
  }

  async function promptFor(ctx: Context, actor: bigint, state: AwaitState, text: string): Promise<void> {
    await setAwait(actor, state);
    await show(ctx, text, cancelButton());
  }

  function errorText(err: unknown): string {
    return `❌ ${escapeHtml(toUserMessage(err))}`;
  }

  // ───────── screens ─────────
  async function linksScreen(ctx: Context): Promise<void> {
    const token = await repos.tokens.getToken();
    const kb = new InlineKeyboard();
    let i = 0;
    for (const [code, meta] of Object.entries(LINKS)) {
      const set = token && !!token[meta.field];
      kb.text(`${set ? '✅' : '➕'} ${meta.label}`, `a:lk:${code}`);
      if (++i % 2 === 0) kb.row();
    }
    kb.row().text('⬅️ Menu', 'a:menu');
    await show(ctx, '<b>🔗 Links</b>\nTap a link to set, change or remove it.\nA button only appears in announcements when its link is set.', kb);
  }

  async function linkScreen(ctx: Context, code: string, note?: string): Promise<void> {
    const meta = LINKS[code];
    if (!meta) return;
    const token = await repos.tokens.getToken();
    const current = token?.[meta.field] ?? null;
    const lines = [`<b>${meta.label}</b>`, `Current: ${current ? escapeHtml(redactUrl(current)) : '<i>not set</i>'}`];
    if (code === 'buy') lines.push('⚠️ The BUY button shows only when launch status is <b>TRADING LIVE</b> and a buy link is set.');
    const kb = new InlineKeyboard().text('✏️ Set / change', `a:lkset:${code}`);
    if (current) kb.text('🗑 Remove', `a:lkc:${code}`);
    kb.row().text('⬅️ Links', 'a:lk');
    await show(ctx, (note ? `${note}\n\n` : '') + lines.join('\n'), kb);
  }

  async function buttonsScreen(ctx: Context, note?: string): Promise<void> {
    const token = await repos.tokens.getToken();
    if (!token) return;
    const settings = await repos.tokens.getButtonSettings(token.id);
    const kb = new InlineKeyboard();
    settings.forEach((s, i) => {
      kb.text(`${s.enabled ? '🟢' : '⚪️'} ${s.key}`, `a:bt:${s.key}`);
      if ((i + 1) % 3 === 0) kb.row();
    });
    kb.row().text('⬅️ Menu', 'a:menu');
    await show(ctx, `${note ? `${note}\n\n` : ''}<b>🔘 Buttons</b>\nTap to switch a button on/off.\nA button also needs a working link to appear.`, kb);
  }

  async function statusScreen(ctx: Context): Promise<void> {
    await show(ctx, await buildStatusHtml(deps), new InlineKeyboard().text('🔄 Reload', 'a:status').text('⬅️ Menu', 'a:menu'));
  }

  async function launchScreen(ctx: Context, note?: string): Promise<void> {
    const token = await repos.tokens.getToken();
    const kb = new InlineKeyboard();
    LAUNCH_STATUSES.forEach((s) => {
      kb.text(`${token?.launchStatus === s ? '✅ ' : ''}${LAUNCH_STATUS_LABELS[s]}`, `a:ls:${s}`).row();
    });
    kb.text('⬅️ Menu', 'a:menu');
    await show(ctx, `${note ? `${note}\n\n` : ''}<b>🚦 Launch status</b>\nThe bot only says trading is live when you pick <b>TRADING LIVE</b>.`, kb);
  }

  // ───────── input handling (free text the admin types after a prompt) ─────────
  async function handleInput(ctx: Context): Promise<boolean> {
    if (!ctx.from || !isPrivateChat(ctx)) return false;
    const actor = BigInt(ctx.from.id);
    const state = await cache.getJson<AwaitState>(awaitKey(actor));
    if (!state) return false;
    if (!(await guard.isAdmin(actor))) return false;
    const text = (ctx.msg?.text ?? ctx.msg?.caption ?? '').trim();
    const photos = ctx.msg?.photo;

    try {
      switch (state.kind) {
        case 'contract': {
          try {
            const res = await admin.setContract(actor, text, {});
            await cache.del(awaitKey(actor));
            await ctx.reply(`✅ Official contract set:\n<code>${escapeHtml(res.checksum)}</code>`, { parse_mode: 'HTML', reply_markup: menuButton() });
          } catch (err) {
            if (err instanceof ContractConfirmationRequired) {
              await cache.setJson(pendingKey(actor), { address: text }, AWAIT_TTL);
              await cache.del(awaitKey(actor));
              await ctx.reply(`⚠️ ${escapeHtml(err.message.split('\n')[0] ?? '')}\nReplace it with:\n<code>${escapeHtml(text)}</code>?`, {
                parse_mode: 'HTML',
                reply_markup: new InlineKeyboard().text('✅ Yes, replace it', 'a:ctok').text('✖️ Cancel', 'a:cancel'),
              });
            } else if (err instanceof ContractNotDeployed) {
              await cache.setJson(pendingKey(actor), { address: text, confirm: true }, AWAIT_TTL);
              await cache.del(awaitKey(actor));
              await ctx.reply('⚠️ No contract code exists at that address on BSC yet (not deployed, or wrong address).\nSet it anyway?', {
                reply_markup: new InlineKeyboard().text('⚠️ Set anyway', 'a:ctforce').text('✖️ Cancel', 'a:cancel'),
              });
            } else throw err;
          }
          return true;
        }
        case 'url': {
          const meta = LINKS[state.code];
          if (!meta) return true;
          const res = await admin.setUrl(actor, meta.field, text);
          await cache.del(awaitKey(actor));
          await ctx.reply(`✅ ${meta.label} saved.${res.warnings.length ? `\n⚠️ ${res.warnings.map(escapeHtml).join('\n⚠️ ')}` : ''}`, {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text('⬅️ Links', 'a:lk').text('⬅️ Menu', 'a:menu'),
          });
          return true;
        }
        case 'description': {
          const saved = await admin.setDescription(actor, text);
          await cache.del(awaitKey(actor));
          await ctx.reply(`✅ Description saved (${saved.length} characters).`, { reply_markup: menuButton() });
          return true;
        }
        case 'logo': {
          if (photos && photos.length > 0) await admin.setLogo(actor, { fileId: photos[photos.length - 1]!.file_id });
          else await admin.setLogo(actor, { url: text });
          await cache.del(awaitKey(actor));
          await ctx.reply('✅ Logo saved.', { reply_markup: menuButton() });
          return true;
        }
        case 'template': {
          await admin.setTemplate(actor, ctx.msg?.text ?? '');
          await cache.del(awaitKey(actor));
          await ctx.reply('✅ Template saved. Tap Preview to see it.', { reply_markup: new InlineKeyboard().text('👁 Preview', 'a:preview').text('⬅️ Menu', 'a:menu') });
          return true;
        }
        case 'addadmin': {
          const id = await admin.addAdmin(actor, text);
          await cache.del(awaitKey(actor));
          await ctx.reply(`✅ Added admin ${id}.`, { reply_markup: menuButton() });
          return true;
        }
        case 'rmadmin': {
          const ok = await admin.removeAdmin(actor, text);
          await cache.del(awaitKey(actor));
          await ctx.reply(ok ? '✅ Admin removed.' : 'That user was not an admin.', { reply_markup: menuButton() });
          return true;
        }
      }
    } catch (err) {
      // Keep the prompt open so the admin can just type a corrected value.
      if (!(err instanceof AppError && err.userSafe)) deps.log.error({ err }, 'Admin panel input failed');
      await ctx.reply(`${errorText(err)}\n\nTry again, or cancel.`, { parse_mode: 'HTML', reply_markup: cancelButton() });
      return true;
    }
    return true;
  }

  // ───────── callbacks ─────────
  function register(bot: Bot): void {
    bot.command(['admin', 'panel', 'menu'], async (ctx) => {
      if (!isPrivateChat(ctx)) return;
      if (!ctx.from || !(await guard.isAdmin(BigInt(ctx.from.id)))) return void (await ctx.reply('⛔ You are not authorized to use this command.'));
      await open(ctx);
    });

    bot.callbackQuery(/^a:/, async (ctx) => {
      const actor = BigInt(ctx.from.id);
      // Authorization is checked on EVERY press: private chat + admin ID.
      if (!isPrivateChat(ctx) || !(await guard.isAdmin(actor))) {
        await ctx.answerCallbackQuery({ text: '⛔ Admins only (use the bot in private chat).', show_alert: true }).catch(() => undefined);
        return;
      }
      const dup = await cache.setNx(`cb:${ctx.callbackQuery.id}`, 300);
      if (!dup) return void (await ctx.answerCallbackQuery().catch(() => undefined));

      const [, action = '', arg = ''] = ctx.callbackQuery.data.split(':');
      let toast: string | undefined;
      try {
        switch (action) {
          case 'menu': await cache.del(awaitKey(actor)); await showMenu(ctx); break;
          case 'cancel': await cache.del(awaitKey(actor)); await cache.del(pendingKey(actor)); await showMenu(ctx, 'Cancelled.'); break;
          case 'status': await statusScreen(ctx); break;
          case 'preview': {
            const built = await deps.announcements.build('PREVIEW', { forceRefresh: true });
            if (!built) toast = 'Set the contract first.';
            else {
              await deps.announcements.send(ctx.api, ctx.chat!.id, built);
              toast = 'Preview sent below.';
            }
            break;
          }
          case 'test':
            await show(ctx, '🧪 Post a <b>TEST announcement</b> in the group now?', new InlineKeyboard().text('✅ Yes, post it', 'a:testgo').text('✖️ Cancel', 'a:cancel'));
            break;
          case 'testgo': {
            const chatId = deps.env.TELEGRAM_GROUP_ID;
            const res = await deps.announcements.publish(ctx.api, { chatId, chatIdBig: BigInt(chatId), kind: 'TEST' });
            if (res) await repos.audit.audit(actor, 'announcement.test', { messageId: res.messageId });
            await showMenu(ctx, res ? '✅ TEST announcement posted in the group.' : '❌ Set the contract first.');
            break;
          }
          case 'refresh': {
            const official = await repos.tokens.getOfficial();
            if (!official?.contract) { toast = 'Set the contract first.'; break; }
            const [onchain, market] = await Promise.all([
              deps.tokenSvc.getOnChain(official.contract.checksum, { force: true }),
              deps.market.get(official.contract.checksum, { force: true }),
            ]);
            await repos.audit.audit(actor, 'data.refresh');
            await showMenu(ctx, `🔄 Refreshed.\nOn-chain: ${onchain ? (onchain.hasCode ? 'ok' : 'no code at address') : 'unavailable'}\nMarket: ${market.status}${market.stale ? ' (stale)' : ''}`);
            break;
          }
          case 'pause': {
            const cfg = await repos.config.get();
            await admin.setPaused(actor, !cfg.paused);
            await showMenu(ctx, cfg.paused ? '▶️ Announcements resumed.' : '⏸ Announcements paused.');
            break;
          }
          // launch status
          case 'ls':
            if (arg && (LAUNCH_STATUSES as readonly string[]).includes(arg)) {
              const res = await admin.setLaunchStatus(actor, arg);
              await launchScreen(ctx, `✅ Launch status: <b>${LAUNCH_STATUS_LABELS[res.status]}</b>${res.warnings.length ? `\n⚠️ ${res.warnings.map(escapeHtml).join('\n⚠️ ')}` : ''}`);
            } else await launchScreen(ctx);
            break;
          // links
          case 'lk': if (arg) await linkScreen(ctx, arg); else await linksScreen(ctx); break;
          case 'lkset': {
            const meta = LINKS[arg];
            if (!meta) break;
            await promptFor(ctx, actor, { kind: 'url', code: arg }, `✏️ Send the new <b>${meta.label}</b> as a message (https://…).${meta.hint ? `\n\n${escapeHtml(meta.hint)}` : ''}`);
            break;
          }
          case 'lkc': {
            const meta = LINKS[arg];
            if (!meta) break;
            await admin.setUrl(actor, meta.field, 'clear');
            await linkScreen(ctx, arg, '🗑 Removed.');
            break;
          }
          // buttons
          case 'bt':
            if (arg && (BUTTON_KEYS as readonly string[]).includes(arg)) {
              const token = await repos.tokens.getToken();
              const current = token ? (await repos.tokens.getButtonSettings(token.id)).find((b) => b.key === arg)?.enabled ?? true : true;
              await admin.setButton(actor, arg, !current);
              await buttonsScreen(ctx, `✅ <b>${arg}</b> is now ${!current ? 'ON' : 'OFF'}.`);
            } else await buttonsScreen(ctx);
            break;
          // contract
          case 'ct': {
            const official = await repos.tokens.getOfficial();
            const cur = official?.contract?.checksum;
            await show(ctx, `<b>📜 Official contract</b>\n${cur ? `<code>${escapeHtml(cur)}</code>` : '<i>not set</i>'}\n\nOnly this exact address triggers announcements.`, new InlineKeyboard().text('✏️ Set / change', 'a:ctset').row().text('⬅️ Menu', 'a:menu'));
            break;
          }
          case 'ctset': await promptFor(ctx, actor, { kind: 'contract' }, '✏️ Send the official contract address (0x…) as a message.\nI will check on BSC that the contract exists.'); break;
          case 'ctok':
          case 'ctforce': {
            const pending = await cache.getJson<{ address: string; confirm?: boolean }>(pendingKey(actor));
            if (!pending) { toast = 'That request expired. Start again.'; break; }
            try {
              const res = await admin.setContract(actor, pending.address, { confirm: true, force: action === 'ctforce' });
              await cache.del(pendingKey(actor));
              await showMenu(ctx, `✅ Official contract set:\n<code>${escapeHtml(res.checksum)}</code>`);
            } catch (err) {
              if (err instanceof ContractNotDeployed) {
                await cache.setJson(pendingKey(actor), { address: pending.address, confirm: true }, AWAIT_TTL);
                await show(ctx, '⚠️ No contract code exists at that address on BSC yet. Set it anyway?', new InlineKeyboard().text('⚠️ Set anyway', 'a:ctforce').text('✖️ Cancel', 'a:cancel'));
              } else throw err;
            }
            break;
          }
          // description
          case 'ds': {
            const token = await repos.tokens.getToken();
            await show(ctx, `<b>📝 Description</b>\n${token?.description ? escapeHtml(truncate(token.description, 500)) : '<i>not set</i>'}`, new InlineKeyboard().text('✏️ Change', 'a:dsset').row().text('⬅️ Menu', 'a:menu'));
            break;
          }
          case 'dsset': await promptFor(ctx, actor, { kind: 'description' }, '✏️ Send the new description as a message (plain text, max 800 characters).'); break;
          // logo
          case 'lg': await show(ctx, '<b>🖼 Logo</b>', new InlineKeyboard().text('✏️ Set / change', 'a:lgset').text('🗑 Remove', 'a:lgc').row().text('⬅️ Menu', 'a:menu')); break;
          case 'lgset': await promptFor(ctx, actor, { kind: 'logo' }, '🖼 Send the logo as a <b>photo</b>, or an https image link.'); break;
          case 'lgc': await admin.setLogo(actor, { clear: true }); await showMenu(ctx, '🗑 Logo removed.'); break;
          // template
          case 'tp':
            await show(ctx, '<b>🧩 Announcement template</b>\nCustomise the whole announcement text.', new InlineKeyboard().text('✏️ Set custom', 'a:tpset').text('♻️ Reset to default', 'a:tpr').row().text('⬅️ Menu', 'a:menu'));
            break;
          case 'tpset':
            await promptFor(ctx, actor, { kind: 'template' }, `✏️ Send your template as a message (Telegram HTML: b, i, u, s, code, a, blockquote).\n\nPlaceholders:\n<code>${TEMPLATE_KEYS.map((k) => `{{${k}}}`).join(' ')}</code>\n\nIt must contain <code>{{contract}}</code>.`);
            break;
          case 'tpr': await admin.setTemplate(actor, null); await showMenu(ctx, '♻️ Default template restored.'); break;
          // admins
          case 'ad': {
            const rows = await repos.admins.list();
            const lines = [...deps.env.TELEGRAM_ADMIN_IDS.map((i) => `• ${i} (primary)`), ...rows.map((r) => `• ${r.telegramId}`)];
            const kb = new InlineKeyboard();
            if (guard.isSuperAdmin(actor)) kb.text('➕ Add admin', 'a:adadd').text('➖ Remove admin', 'a:adrm').row();
            kb.text('⬅️ Menu', 'a:menu');
            await show(ctx, `<b>👥 Administrators</b>\n${lines.join('\n')}${guard.isSuperAdmin(actor) ? '' : '\n\n<i>Only primary admins can add or remove admins.</i>'}`, kb);
            break;
          }
          case 'adadd': guard.assertSuperAdmin(actor); await promptFor(ctx, actor, { kind: 'addadmin' }, '✏️ Send the numeric Telegram user ID of the new admin.\n(They can get it from @userinfobot.)'); break;
          case 'adrm': guard.assertSuperAdmin(actor); await promptFor(ctx, actor, { kind: 'rmadmin' }, '✏️ Send the numeric Telegram user ID to remove.'); break;
          default: break;
        }
      } catch (err) {
        if (!(err instanceof AppError && err.userSafe)) deps.log.error({ err }, 'Admin panel action failed');
        toast = toUserMessage(err).slice(0, 190);
      }
      await ctx.answerCallbackQuery(toast ? { text: toast, show_alert: toast.length > 40 } : undefined).catch((err) => {
        if (!isTelegramMessageGone(err)) throw err;
      });
    });
  }

  return { register, open, handleInput };
}
