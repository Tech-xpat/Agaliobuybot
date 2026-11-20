import type { Logger } from 'pino';
import type { CacheService } from '../services/cache.service';
import { detectContract } from './contract-detector';

export interface IncomingMessage {
  chatId: bigint;
  messageId: number;
  userId: bigint | null;
  text: string;
  isForward: boolean;
  fromBot: boolean;
}

export type Decision =
  | { action: 'ignore'; reason: string }
  | { action: 'announce'; contract: string; groupDbId: string; tokenId: string };

export interface ProcessorSettings {
  enabled: boolean;
  paused: boolean;
  cooldownSeconds: number;
}

export interface ProcessorDeps {
  configuredChatId: bigint;
  getSettings(): Promise<ProcessorSettings>;
  getOfficial(): Promise<{ tokenId: string; contractLower: string } | null>;
  ensureGroup(chatId: bigint): Promise<{ id: string }>;
  /** durable idempotency: true if newly recorded, false if already processed */
  recordDetection(input: { groupId: string; messageId: number; userId: bigint | null; contract: string; isForward: boolean }): Promise<boolean>;
  cache: CacheService;
  log: Logger;
}

/**
 * Decides whether a group message should trigger the official announcement.
 * Order matters: cheap checks first, then exact match, then idempotency, then cooldown.
 */
export async function processMessage(msg: IncomingMessage, deps: ProcessorDeps): Promise<Decision> {
  if (msg.chatId !== deps.configuredChatId) return { action: 'ignore', reason: 'not-configured-group' };
  if (msg.fromBot) return { action: 'ignore', reason: 'bot-sender' };
  if (!msg.text) return { action: 'ignore', reason: 'no-text' };

  const settings = await deps.getSettings();
  if (!settings.enabled) return { action: 'ignore', reason: 'announcements-disabled' };
  if (settings.paused) return { action: 'ignore', reason: 'paused' };

  const official = await deps.getOfficial();
  if (!official) return { action: 'ignore', reason: 'no-official-contract' };

  const result = detectContract(msg.text, official.contractLower);
  if (!result.officialMatched || !result.matched) {
    if (result.found.length > 0) deps.log.debug({ count: result.found.length }, 'Ignoring non-official contract address');
    return { action: 'ignore', reason: 'no-official-match' };
  }

  const group = await deps.ensureGroup(msg.chatId);
  const contract = result.matched.lower;
  const chat = msg.chatId.toString();

  // 1) Idempotency per (chat, message, contract): fast cache path, durable DB path.
  const fresh = await deps.cache.setNx(`dedup:${chat}:${msg.messageId}:${contract}`, 86_400);
  if (!fresh) return { action: 'ignore', reason: 'duplicate' };
  const recorded = await deps.recordDetection({
    groupId: group.id,
    messageId: msg.messageId,
    userId: msg.userId,
    contract,
    isForward: msg.isForward,
  });
  if (!recorded) return { action: 'ignore', reason: 'duplicate' };

  // 2) Cooldown to prevent announcement flooding.
  if (settings.cooldownSeconds > 0) {
    const ok = await deps.cache.setNx(`cooldown:${chat}`, settings.cooldownSeconds);
    if (!ok) return { action: 'ignore', reason: 'cooldown' };
  }

  return { action: 'announce', contract: result.matched.checksum, groupDbId: group.id, tokenId: official.tokenId };
}
