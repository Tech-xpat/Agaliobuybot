import type { Bot } from 'grammy';
import type { BotDeps } from '../context';

/** Logs when the bot is added to / removed from chats, and warns about unconfigured groups. */
export function registerChatMemberHandler(bot: Bot, deps: BotDeps): void {
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    const status = ctx.myChatMember.new_chat_member.status;
    const configured = String(chat.id) === deps.env.TELEGRAM_GROUP_ID;
    deps.log.info({ chatId: chat.id, type: chat.type, status, configured }, 'Bot membership changed');
    await deps.repos.audit.event(configured ? 'info' : 'warn', 'chat.member', `Bot is now ${status} in ${chat.type} ${chat.id}`, {
      chatId: chat.id,
      configured,
    });
    if (!configured && chat.type !== 'private' && (status === 'member' || status === 'administrator')) {
      deps.log.warn({ chatId: chat.id }, 'Bot added to a group that is not TELEGRAM_GROUP_ID. It will ignore messages there.');
    }
  });
}
