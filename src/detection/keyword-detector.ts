import { stripInvisible } from '../utils/sanitizers';

/**
 * Plain-language "give me the contract/info" requests such as:
 *   ca · CA? · wen ca · what's the ca · drop ca pls · contract address · c.a
 * Only matches when the WHOLE message is such a request, so ordinary chat that merely
 * contains the letters "ca" never triggers the bot.
 */
const FILLER = "(?:what(?:'s|s| is)|where(?:'s|s| is)|drop|send|post|give(?: me)?|gimme|show|share|wen|when|pls|please|plz|the|a|your|new|official|anyone|someone|can i get|can you|need|i need)";
const WORD = '(?:ca|c\\.a|contract(?: address)?|token address)';
const TAIL = '(?:pls|please|plz|fam|ser|sir|anyone|guys|team|again|now|bro|\\?|!|\\.)';
const PATTERN = new RegExp(`^(?:${FILLER}\\s+)*${WORD}(?:\\s*${TAIL})*$`, 'i');

export function isInfoRequest(text: string): boolean {
  const t = stripInvisible(text)
    .toLowerCase()
    .replace(/[^a-z0-9?!.' ]+/g, ' ') // drops emojis/punctuation noise
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 40) return false;
  return PATTERN.test(t);
}
