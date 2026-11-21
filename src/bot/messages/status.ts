import { LAUNCH_STATUS_LABELS, type LaunchStatusValue } from '../../config/constants';
import { redactUrl } from '../../utils/formatters';
import { escapeHtml } from '../../utils/sanitizers';
import type { BotDeps } from '../context';

export async function buildStatusHtml(deps: BotDeps): Promise<string> {
  const { repos } = deps;
  const [token, cfg, official] = await Promise.all([repos.tokens.getToken(), repos.config.get(), repos.tokens.getOfficial()]);
  const contract = official?.contract?.checksum;
  const [dbOk, redisOk, rpc] = await Promise.all([deps.dbPing(), deps.cache.ping(), deps.bsc.checkHealth()]);
  const market = contract ? await deps.market.get(contract) : null;
  return [
    '<b>AGALIO BuyBot status</b>',
    `Mode: ${deps.env.BOT_MODE} · Jobs: ${deps.jobs.running}`,
    `Announcements: ${cfg.announcementEnabled ? 'on' : 'off'} · Paused: ${cfg.paused ? 'YES' : 'no'} · Cooldown: ${cfg.cooldownSeconds}s`,
    `Launch status: <b>${token ? LAUNCH_STATUS_LABELS[token.launchStatus as LaunchStatusValue] : '?'}</b>`,
    `Contract: ${contract ? `<code>${escapeHtml(contract)}</code>` : '<b>NOT SET</b>'}`,
    `Custom template: ${cfg.announcementTemplate ? 'yes' : 'default'}`,
    '',
    '<b>Health</b>',
    `Database: ${dbOk ? '✅' : '❌'} · Redis: ${redisOk ? '✅' : '⚠️ fallback to memory'}`,
    ...rpc.map((r) => `RPC ${r.role} (${escapeHtml(r.host)}): ${r.ok ? `✅ ${r.latencyMs}ms, block ${r.lastBlock}` : `❌ ${escapeHtml(r.lastError ?? 'unknown')}`}`),
    `Market data: ${market ? `${market.status}${market.stale ? ' (stale)' : ''} via ${market.providerName}` : 'n/a'}`,
    '',
    '<b>Links</b>',
    `Buy: ${redactUrl(token?.buyUrl)} · Chart: ${redactUrl(token?.chartUrl)}`,
    `Community: ${redactUrl(token?.communityUrl)} · Website: ${redactUrl(token?.websiteUrl)}`,
  ].join('\n');
}
