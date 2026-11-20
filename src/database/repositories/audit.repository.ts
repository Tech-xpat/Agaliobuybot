import type { AuditLog, BotEvent, Prisma } from '@prisma/client';
import type { Db } from '../prisma';

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue;
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  async audit(actorId: bigint | null, action: string, details?: unknown): Promise<void> {
    await this.db.auditLog.create({ data: { actorId, action, details: toJson(details) } });
  }

  async event(level: 'info' | 'warn' | 'error', type: string, message: string, meta?: unknown): Promise<void> {
    try {
      await this.db.botEvent.create({ data: { level, type, message: message.slice(0, 500), meta: toJson(meta) } });
    } catch {
      /* event logging must never break the caller */
    }
  }

  async recentAudit(limit = 10): Promise<AuditLog[]> {
    return this.db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }

  async recentEvents(limit = 10): Promise<BotEvent[]> {
    return this.db.botEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
}
