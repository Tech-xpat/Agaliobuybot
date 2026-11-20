import type { Announcement } from '@prisma/client';
import type { Db } from '../prisma';

export interface RecordAnnouncementInput {
  tokenId: string;
  groupId: string;
  triggerMsgId?: number | null;
  telegramMessageId?: number | null;
  contract: string;
  kind: string;
}

export interface DetectionInput {
  groupId: string;
  messageId: number;
  userId?: bigint | null;
  contract: string;
  matched: boolean;
  isForward: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

export class AnnouncementRepository {
  constructor(private readonly db: Db) {}

  async record(input: RecordAnnouncementInput): Promise<Announcement> {
    return this.db.announcement.create({
      data: {
        tokenId: input.tokenId,
        groupId: input.groupId,
        triggerMsgId: input.triggerMsgId ?? null,
        telegramMessageId: input.telegramMessageId ?? null,
        contract: input.contract.toLowerCase(),
        kind: input.kind,
      },
    });
  }

  async recent(limit = 10): Promise<Announcement[]> {
    return this.db.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }

  /**
   * Durable idempotency: returns true if this (group, message, contract) was newly
   * recorded, false if it had already been processed (unique violation).
   */
  async tryRecordDetection(input: DetectionInput): Promise<boolean> {
    try {
      await this.db.detectedMessage.create({
        data: {
          groupId: input.groupId,
          messageId: input.messageId,
          userId: input.userId ?? null,
          contract: input.contract.toLowerCase(),
          matched: input.matched,
          isForward: input.isForward,
        },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
}
