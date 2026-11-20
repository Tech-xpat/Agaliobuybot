import { GrammyError, HttpError, type BotError, type Context } from 'grammy';
import { isTelegramMessageGone } from '../../utils/errors';
import type { BotDeps } from '../context';

/** Central error handler: logs details, never sends internals to Telegram. */
export function createErrorHandler(deps: BotDeps) {
  return async (err: BotError<Context>): Promise<void> => {
    const e = err.error;
    const updateId = err.ctx.update.update_id;
    if (isTelegramMessageGone(e)) {
      deps.log.debug({ updateId }, 'Ignoring expired callback or unchanged message');
      return;
    }
    if (e instanceof GrammyError) {
      deps.log.error({ updateId, description: e.description, code: e.error_code }, 'Telegram API error');
    } else if (e instanceof HttpError) {
      deps.log.error({ updateId, err: e.message }, 'Network error talking to Telegram');
    } else {
      deps.log.error({ updateId, err: e }, 'Unhandled bot error');
    }
    await deps.repos.audit.event('error', 'bot.error', e instanceof Error ? e.message : String(e), { updateId });
  };
}
