import { AuthorizationError } from '../utils/errors';

export interface AdminLookup {
  isActive(telegramId: bigint): Promise<boolean>;
}

/**
 * Authorization by Telegram user ID only. Never by username or display name.
 * Env admins are "super admins" (can add/remove DB admins). DB admins can configure the bot.
 */
export class AdminGuard {
  private readonly envAdmins: Set<string>;

  constructor(
    envAdminIds: bigint[],
    private readonly lookup: AdminLookup,
  ) {
    this.envAdmins = new Set(envAdminIds.map((i) => i.toString()));
  }

  isSuperAdmin(userId: bigint | undefined | null): boolean {
    return userId !== undefined && userId !== null && this.envAdmins.has(userId.toString());
  }

  async isAdmin(userId: bigint | undefined | null): Promise<boolean> {
    if (userId === undefined || userId === null) return false;
    if (this.isSuperAdmin(userId)) return true;
    try {
      return await this.lookup.isActive(userId);
    } catch {
      return false; // fail closed
    }
  }

  async assertAdmin(userId: bigint | undefined | null): Promise<bigint> {
    if (!(await this.isAdmin(userId))) throw new AuthorizationError();
    return userId as bigint;
  }

  assertSuperAdmin(userId: bigint | undefined | null): bigint {
    if (!this.isSuperAdmin(userId)) throw new AuthorizationError('Only the primary administrators can do that.');
    return userId as bigint;
  }
}
