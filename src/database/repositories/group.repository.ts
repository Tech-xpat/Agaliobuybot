import type { TelegramGroup } from '@prisma/client';
import type { Db } from '../prisma';

export class GroupRepository {
  constructor(private readonly db: Db) {}

  async ensure(chatId: bigint, title?: string | null): Promise<TelegramGroup> {
    return this.db.telegramGroup.upsert({
      where: { chatId },
      create: { chatId, title: title ?? null },
      update: title ? { title } : {},
    });
  }

  async get(chatId: bigint): Promise<TelegramGroup | null> {
    return this.db.telegramGroup.findUnique({ where: { chatId } });
  }
}
