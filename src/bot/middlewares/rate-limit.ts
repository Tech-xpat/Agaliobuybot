import type { Context, MiddlewareFn } from 'grammy';
import type { BotDeps } from '../context';

/** Per-user fixed-window limit for commands and button presses. Primary admins are exempt. */
export function rateLimit(deps: BotDeps): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const isCommand = ctx.msg?.entities?.some((e) => e.type === 'bot_command') ?? false;
    if (!ctx.from || !(ctx.callbackQuery || isCommand)) return next();
    if (deps.guard.isSuperAdmin(BigInt(ctx.from.id))) return next();
    const n = await deps.cache.incrWindow(`rl:${ctx.from.id}`, 60);
    if (n > deps.env.USER_RATE_LIMIT_PER_MINUTE) {
      if (n === deps.env.USER_RATE_LIMIT_PER_MINUTE + 1) deps.log.info({ userId: ctx.from.id }, 'Rate limit hit');
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Slow down a little 🙂' }).catch(() => undefined);
      return;
    }
    return next();
  };
}
