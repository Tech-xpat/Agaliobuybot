import type { Context } from 'grammy';

export function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private';
}

export function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

export function userIdOf(ctx: Context): bigint | undefined {
  return ctx.from ? BigInt(ctx.from.id) : undefined;
}

/** True when the message starts with a bot command (those are handled by command handlers). */
export function startsWithCommand(msg: { text?: string; entities?: { type: string; offset: number }[]; caption?: string; caption_entities?: { type: string; offset: number }[] }): boolean {
  const entities = msg.entities ?? msg.caption_entities ?? [];
  return entities.some((e) => e.type === 'bot_command' && e.offset === 0);
}
