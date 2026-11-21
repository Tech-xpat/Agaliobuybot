import { stripInvisible } from '../utils/sanitizers';

export type LinkTopic = 'website' | 'twitter' | 'whitepaper' | 'tokenomics' | 'security' | 'community' | 'chart' | 'buy' | 'all';

/** Words that name a topic. "x" and "buy" are handled separately because they are too common on their own. */
const TOPIC_WORDS: Record<string, LinkTopic> = {
  website: 'website',
  websites: 'website',
  webpage: 'website',
  site: 'website',
  web: 'website',
  twitter: 'twitter',
  whitepaper: 'whitepaper',
  tokenomics: 'tokenomics',
  tokenomic: 'tokenomics',
  audit: 'security',
  audits: 'security',
  security: 'security',
  community: 'community',
  chart: 'chart',
  charts: 'chart',
  dexscreener: 'chart',
  socials: 'all',
  social: 'all',
  links: 'all',
};

/** Words that make a bare "x" or "buy" clearly a request ("x link", "official x", "how to buy"). */
const QUALIFIERS = new Set(['link', 'url', 'page', 'account', 'handle', 'profile', 'official', 'how', 'where', 'wheres']);

/** Polite or conversational words that may surround a topic without changing the meaning. */
const FILLER = new Set([
  'what', 'whats', 'where', 'wheres', 'how', 'when', 'wen', 'is', 'are', 'the', 'a', 'an', 'your', 'our', 'new', 'official',
  'drop', 'send', 'post', 'give', 'gimme', 'me', 'show', 'share', 'pls', 'please', 'plz', 'can', 'i', 'you', 'get', 'need',
  'anyone', 'someone', 'fam', 'ser', 'sir', 'guys', 'team', 'again', 'now', 'bro', 'of', 'to', 'for', 'and', 'or', 'also', 'all',
  'link', 'url', 'page', 'account', 'handle', 'profile',
]);

const MAX_CHARS = 60;
const MAX_TOKENS = 9;

function normalize(text: string): string {
  return stripInvisible(text)
    .toLowerCase()
    .replace(/white\s+paper/g, 'whitepaper')
    .replace(/token\s+economics/g, 'tokenomics')
    .replace(/'/g, '') // what's -> whats
    .replace(/[^a-z0-9 ]+/g, ' ') // emojis, punctuation, "twitter/x"
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects plain-language requests for a project link, such as:
 *   website · wen whitepaper · what's the twitter? · twitter or x · official x link ·
 *   tokenomics pls · how to buy · socials
 * Only matches when the WHOLE message is such a request (every word is a topic or filler word),
 * so ordinary chat like "my website is down" or "x is pumping" never triggers the bot.
 * Returns the topics in the order they were asked, or [] when the message is not a request.
 */
export function detectLinkRequest(text: string): LinkTopic[] {
  const t = normalize(text);
  if (!t || t.length > MAX_CHARS) return [];
  const tokens = t.split(' ');
  if (tokens.length > MAX_TOKENS) return [];

  const hasQualifier = tokens.some((w) => QUALIFIERS.has(w));
  const hasTwitterWord = tokens.includes('twitter');
  const topics: LinkTopic[] = [];
  const add = (topic: LinkTopic) => {
    if (!topics.includes(topic)) topics.push(topic);
  };

  for (const w of tokens) {
    if (w === 'x') {
      if (hasTwitterWord) continue; // "twitter or x"
      if (!hasQualifier) return [];
      add('twitter');
    } else if (w === 'buy') {
      if (!hasQualifier) return [];
      add('buy');
    } else if (TOPIC_WORDS[w]) {
      add(TOPIC_WORDS[w]!);
    } else if (!FILLER.has(w)) {
      return [];
    }
  }

  if (topics.includes('all')) return ['all'];
  return topics;
}
