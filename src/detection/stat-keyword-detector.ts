import { stripInvisible } from '../utils/sanitizers';

export type StatTopic = 'price' | 'marketcap' | 'fdv' | 'liquidity' | 'volume' | 'holders' | 'supply' | 'decimals';

/** Words that name a stat. */
const TOPIC_WORDS: Record<string, StatTopic> = {
  price: 'price',
  prices: 'price',
  marketcap: 'marketcap',
  mcap: 'marketcap',
  mktcap: 'marketcap',
  mc: 'marketcap',
  fdv: 'fdv',
  liquidity: 'liquidity',
  liq: 'liquidity',
  volume: 'volume',
  vol: 'volume',
  holders: 'holders',
  holder: 'holders',
  supply: 'supply',
  decimals: 'decimals',
};

/** Polite or conversational words that may surround a topic without changing the meaning. */
const FILLER = new Set([
  'what', 'whats', 'where', 'wheres', 'how', 'many', 'when', 'wen', 'is', 'are', 'the', 'a', 'an', 'its', 'it', 'of', 'for', 'and', 'or', 'also',
  'current', 'currently', 'now', 'right', 'rn', 'today', 'total', 'circulating', '24h', '24hr', 'agalio', 'token', 'coin',
  'drop', 'send', 'post', 'give', 'gimme', 'me', 'show', 'share', 'tell', 'pls', 'please', 'plz', 'can', 'i', 'you', 'get', 'need',
  'anyone', 'someone', 'fam', 'ser', 'sir', 'guys', 'team', 'again', 'bro', 'check',
]);

const MAX_CHARS = 60;
const MAX_TOKENS = 9;

function normalize(text: string): string {
  return stripInvisible(text)
    .toLowerCase()
    .replace(/market\s*cap(?:italization|italisation)?/g, 'marketcap')
    .replace(/mkt\s*cap/g, 'mktcap')
    .replace(/\bm\s+cap\b/g, 'mcap')
    .replace(/how\s+much(?:\s+is)?/g, 'price') // "how much is agalio"
    .replace(/'/g, '') // what's -> whats
    .replace(/[^a-z0-9 ]+/g, ' ') // emojis, punctuation, $ signs
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects plain-language requests for ONE specific number, such as:
 *   price · mc · what's the market cap · liquidity? · holders · total supply · price and volume
 * Only matches when the WHOLE message is such a request (every word is a stat or filler word),
 * so ordinary chat like "price is dumping" or "the volume was crazy" never triggers the bot.
 * Returns the topics in the order they were asked, or [] when the message is not a request.
 */
export function detectStatRequest(text: string): StatTopic[] {
  const t = normalize(text);
  if (!t || t.length > MAX_CHARS) return [];
  const tokens = t.split(' ');
  if (tokens.length > MAX_TOKENS) return [];

  const topics: StatTopic[] = [];
  for (const w of tokens) {
    const topic = TOPIC_WORDS[w];
    if (topic) {
      if (!topics.includes(topic)) topics.push(topic);
    } else if (!FILLER.has(w)) {
      return [];
    }
  }
  return topics;
}
