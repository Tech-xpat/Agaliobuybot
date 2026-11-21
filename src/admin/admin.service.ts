import { BUTTON_KEYS, EXTRA_LINK_FIELDS, LAUNCH_STATUSES, MAX_DESCRIPTION_LENGTH, URL_FIELDS, type ButtonKey, type LaunchStatusValue, type UrlField } from '../config/constants';
import { addressSchema } from '../config/validation';
import { validateTemplate } from '../announcements/announcement.templates';
import type { Repositories } from '../database/repositories';
import { validateExternalUrl } from '../services/url.service';
import { ValidationError } from '../utils/errors';
import { cleanText } from '../utils/sanitizers';
import type { AdminGuard } from './admin.guard';

export interface ContractChecker {
  hasCode(address: string): Promise<boolean>;
}

export interface AdminServiceDeps {
  guard: AdminGuard;
  repos: Repositories;
  contracts: ContractChecker;
  /** called after config changes so cached data is dropped */
  onContractChanged?: (address: string) => Promise<void>;
}

export class ContractConfirmationRequired extends ValidationError {
  constructor(public readonly current: string) {
    super(`An official contract is already set (${current}).\nChanging it affects what the bot announces. Re-run with the word "confirm" at the end to proceed.`);
  }
}

export class ContractNotDeployed extends ValidationError {
  constructor() {
    super('No contract code exists at that address on BSC (not deployed yet, or wrong address).\nAdd the word "force" at the end to set it anyway.');
  }
}

export interface SetContractResult {
  checksum: string;
  replaced: boolean;
  hasCode: boolean;
}

/**
 * All state-changing admin operations. Every method authorizes first, validates input,
 * changes state, then writes an audit log entry.
 */
export class AdminService {
  constructor(private readonly d: AdminServiceDeps) {}

  private async token() {
    const t = await this.d.repos.tokens.getToken();
    if (!t) throw new ValidationError('Token is not initialised yet. Restart the bot.');
    return t;
  }

  async setContract(actor: bigint | undefined, raw: string, opts: { confirm?: boolean; force?: boolean } = {}): Promise<SetContractResult> {
    const actorId = await this.d.guard.assertAdmin(actor);
    const parsed = addressSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid address');
    const checksum = parsed.data;
    const lower = checksum.toLowerCase();

    const token = await this.token();
    const current = await this.d.repos.tokens.getOfficialContract(token.id);
    const replaced = !!current && current.address !== lower;
    if (replaced && !opts.confirm) {
      throw new ContractConfirmationRequired(current!.checksum);
    }

    let hasCode: boolean;
    try {
      hasCode = await this.d.contracts.hasCode(checksum);
    } catch {
      throw new ValidationError('Could not verify the contract on BSC right now (RPC problem). Try again shortly.');
    }
    if (!hasCode && !opts.force) {
      throw new ContractNotDeployed();
    }

    await this.d.repos.tokens.setOfficialContract(token.id, { lower, checksum }, actorId);
    await this.d.repos.audit.audit(actorId, 'contract.set', { address: checksum, previous: current?.checksum ?? null, hasCode, forced: !!opts.force });
    if (current) await this.d.onContractChanged?.(current.checksum);
    await this.d.onContractChanged?.(checksum);
    return { checksum, replaced, hasCode };
  }

  async setUrl(actor: bigint | undefined, field: UrlField, value: string): Promise<{ value: string | null; warnings: string[] }> {
    const actorId = await this.d.guard.assertAdmin(actor);
    if (!(URL_FIELDS as readonly string[]).includes(field)) throw new ValidationError('Unknown link type.');
    const clear = /^(clear|none|off|-)$/i.test(value.trim());
    const url = clear ? null : validateExternalUrl(value);
    const token = await this.token();
    await this.d.repos.tokens.update(token.id, { [field]: url });
    await this.d.repos.audit.audit(actorId, `url.${field}`, { value: url });
    const warnings: string[] = [];
    if (field === 'buyUrl' && url && token.launchStatus !== 'TRADING_LIVE') {
      warnings.push('The BUY button stays hidden until the launch status is TRADING_LIVE.');
    }
    return { value: url, warnings };
  }

  async setLink(actor: bigint | undefined, name: string, value: string) {
    const field = EXTRA_LINK_FIELDS[name.toLowerCase()];
    if (!field) throw new ValidationError(`Unknown link. Use one of: ${Object.keys(EXTRA_LINK_FIELDS).join(', ')}`);
    return this.setUrl(actor, field, value);
  }

  async setDescription(actor: bigint | undefined, text: string): Promise<string> {
    const actorId = await this.d.guard.assertAdmin(actor);
    const clean = cleanText(text, MAX_DESCRIPTION_LENGTH + 1);
    if (!clean) throw new ValidationError('Description is empty.');
    if (clean.length > MAX_DESCRIPTION_LENGTH) throw new ValidationError(`Description is too long (max ${MAX_DESCRIPTION_LENGTH} characters).`);
    const token = await this.token();
    await this.d.repos.tokens.update(token.id, { description: clean });
    await this.d.repos.audit.audit(actorId, 'description.set', { length: clean.length });
    return clean;
  }

  async setLaunchStatus(actor: bigint | undefined, raw: string): Promise<{ status: LaunchStatusValue; warnings: string[] }> {
    const actorId = await this.d.guard.assertAdmin(actor);
    const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!(LAUNCH_STATUSES as readonly string[]).includes(normalized)) {
      throw new ValidationError(`Unknown status. Use one of:\n${LAUNCH_STATUSES.join('\n')}`);
    }
    const status = normalized as LaunchStatusValue;
    const token = await this.token();
    const previous = token.launchStatus;
    await this.d.repos.tokens.update(token.id, { launchStatus: status });
    await this.d.repos.audit.audit(actorId, 'launch_status.set', { previous, status });
    const warnings: string[] = [];
    if (status === 'TRADING_LIVE' && !token.buyUrl) warnings.push('No buy URL is set, so the BUY button will stay hidden. Use /setbuyurl.');
    return { status, warnings };
  }

  async setButton(actor: bigint | undefined, key: string, enabled: boolean): Promise<ButtonKey> {
    const actorId = await this.d.guard.assertAdmin(actor);
    const k = key.toLowerCase();
    if (!(BUTTON_KEYS as readonly string[]).includes(k)) throw new ValidationError(`Unknown button. Use one of: ${BUTTON_KEYS.join(', ')}`);
    const token = await this.token();
    await this.d.repos.tokens.setButtonEnabled(token.id, k as ButtonKey, enabled);
    await this.d.repos.audit.audit(actorId, 'button.set', { key: k, enabled });
    return k as ButtonKey;
  }

  async setPaused(actor: bigint | undefined, paused: boolean): Promise<void> {
    const actorId = await this.d.guard.assertAdmin(actor);
    await this.d.repos.config.update({ paused });
    await this.d.repos.audit.audit(actorId, paused ? 'bot.pause' : 'bot.resume');
  }

  async setTemplate(actor: bigint | undefined, template: string | null): Promise<void> {
    const actorId = await this.d.guard.assertAdmin(actor);
    if (template !== null) validateTemplate(template);
    await this.d.repos.config.update({ announcementTemplate: template });
    await this.d.repos.audit.audit(actorId, template === null ? 'template.reset' : 'template.set', { length: template?.length ?? 0 });
  }

  async setLogo(actor: bigint | undefined, input: { fileId?: string; url?: string; clear?: boolean }): Promise<void> {
    const actorId = await this.d.guard.assertAdmin(actor);
    const token = await this.token();
    if (input.clear) {
      await this.d.repos.tokens.update(token.id, { logoFileId: null, logoPath: null });
    } else if (input.fileId) {
      await this.d.repos.tokens.update(token.id, { logoFileId: input.fileId });
    } else if (input.url) {
      const url = validateExternalUrl(input.url);
      await this.d.repos.tokens.update(token.id, { logoPath: url, logoFileId: null });
    } else {
      throw new ValidationError('Provide a photo (reply to one), an https URL, or "clear".');
    }
    await this.d.repos.audit.audit(actorId, 'logo.set', { kind: input.clear ? 'clear' : input.fileId ? 'file_id' : 'url' });
  }

  async addAdmin(actor: bigint | undefined, rawId: string): Promise<bigint> {
    const actorId = this.d.guard.assertSuperAdmin(actor);
    if (!/^\d{3,15}$/.test(rawId.trim())) throw new ValidationError('Provide a numeric Telegram user ID.');
    const id = BigInt(rawId.trim());
    await this.d.repos.admins.add(id, actorId);
    await this.d.repos.audit.audit(actorId, 'admin.add', { telegramId: id });
    return id;
  }

  async removeAdmin(actor: bigint | undefined, rawId: string): Promise<boolean> {
    const actorId = this.d.guard.assertSuperAdmin(actor);
    if (!/^\d{3,15}$/.test(rawId.trim())) throw new ValidationError('Provide a numeric Telegram user ID.');
    const id = BigInt(rawId.trim());
    if (this.d.guard.isSuperAdmin(id)) throw new ValidationError('Primary administrators are set in the environment and cannot be removed here.');
    const removed = await this.d.repos.admins.deactivate(id);
    await this.d.repos.audit.audit(actorId, 'admin.remove', { telegramId: id, removed });
    return removed;
  }
}
