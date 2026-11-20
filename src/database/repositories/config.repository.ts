import type { BotConfiguration } from '@prisma/client';
import type { Env } from '../../config/env';
import type { Db } from '../prisma';

export class ConfigRepository {
  constructor(private readonly db: Db) {}

  async ensure(env: Env): Promise<BotConfiguration> {
    return this.db.botConfiguration.upsert({
      where: { id: 1 },
      create: { id: 1, announcementEnabled: env.ANNOUNCEMENT_ENABLED, cooldownSeconds: env.ANNOUNCEMENT_COOLDOWN_SECONDS },
      update: {},
    });
  }

  async get(): Promise<BotConfiguration> {
    const row = await this.db.botConfiguration.findUnique({ where: { id: 1 } });
    if (row) return row;
    return this.db.botConfiguration.create({ data: { id: 1 } });
  }

  async update(data: Partial<Pick<BotConfiguration, 'announcementEnabled' | 'paused' | 'cooldownSeconds' | 'announcementTemplate'>>): Promise<BotConfiguration> {
    return this.db.botConfiguration.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  }
}
