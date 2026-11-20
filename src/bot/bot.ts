import { Bot } from 'grammy';
import { registerAdminCommands } from './commands/admin.commands';
import { registerPublicCommands } from './commands/public.commands';
import type { BotDeps } from './context';
import { registerCallbackHandlers } from './handlers/callback.handler';
import { registerChatMemberHandler } from './handlers/chat-member.handler';
import { registerGroupMessageHandler } from './handlers/group-message.handler';
import { createErrorHandler } from './middlewares/error-handler';
import { rateLimit } from './middlewares/rate-limit';

export const ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query', 'my_chat_member'] as const;

export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.env.TELEGRAM_BOT_TOKEN);
  bot.catch(createErrorHandler(deps));
  bot.use(rateLimit(deps));
  registerChatMemberHandler(bot, deps);
  registerPublicCommands(bot, deps);
  registerAdminCommands(bot, deps);
  registerCallbackHandlers(bot, deps);
  registerGroupMessageHandler(bot, deps);
  return bot;
}
