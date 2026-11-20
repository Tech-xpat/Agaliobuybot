import type { Administrator } from '@prisma/client';
import type { Db } from '../prisma';

export class AdminRepository {
  constructor(private readonly db: Db) {}

  async isActive(telegramId: bigint): Promise<boolean> {
    const row = await this.db.administrator.findUnique({ where: { telegramId } });
    return row?.active === true;
  }

  async add(telegramId: bigint, addedBy: bigint, username?: string | null): Promise<Administrator> {
    return this.db.administrator.upsert({
      where: { telegramId },
      create: { telegramId, addedBy, username: username ?? null, active: true },
      update: { active: true },
    });
  }

  async deactivate(telegramId: bigint): Promise<boolean> {
    const res = await this.db.administrator.updateMany({ where: { telegramId, active: true }, data: { active: false } });
    return res.count > 0;
  }

  async list(): Promise<Administrator[]> {
    return this.db.administrator.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  }
}
