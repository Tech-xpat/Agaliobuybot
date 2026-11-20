import { MAX_TEMPLATE_LENGTH } from '../config/constants';
import { ValidationError } from '../utils/errors';

export const TEMPLATE_KEYS = [
  'name',
  'symbol',
  'contract',
  'chain',
  'status',
  'status_note',
  'decimals',
  'total_supply',
  'price',
  'market_cap',
  'fdv',
  'liquidity',
  'volume_24h',
  'price_change_24h',
  'holders',
  'dex',
  'pair',
  'pair_created',
  'market_note',
  'description',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Three provenance sections: on-chain facts, third-party market data, admin-supplied info. */
export const DEFAULT_TEMPLATE = `<b>🚀 {{name}} ({{symbol}}) — {{status}}</b>
{{status_note}}

<b>📜 Official contract ({{chain}})</b>
<code>{{contract}}</code>

<b>⛓ On-chain (read from BSC RPC)</b>
Decimals: {{decimals}}
Total supply: {{total_supply}}

<b>📊 Market data (third-party, may be delayed)</b>
Price: {{price}}
Market cap: {{market_cap}}
Liquidity: {{liquidity}}
24h volume: {{volume_24h}}
Holders: {{holders}}
{{market_note}}

<b>ℹ️ About (provided by AGALIO admins)</b>
{{description}}

<i>Not financial advice. This bot does not audit tokens. Always verify the contract address yourself.</i>`;

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'tg-spoiler', 'blockquote']);
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(PLACEHOLDER, (_m, key: string) => values[key] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Validates Telegram HTML structure: allowed tags only, balanced, no stray < > &. */
export function validateTelegramHtml(html: string): void {
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let rest = html;
  for (const m of html.matchAll(tagRe)) {
    const full = m[0];
    const name = (m[1] ?? '').toLowerCase();
    const attrs = m[2] ?? '';
    if (!ALLOWED_TAGS.has(name)) throw new ValidationError(`HTML tag <${name}> is not allowed by Telegram.`);
    if (full.startsWith('</')) {
      if (stack.pop() !== name) throw new ValidationError(`Mismatched closing tag </${name}>.`);
    } else {
      if (name === 'a' && !/^\s+href="https:\/\/[^"\s]+"\s*$/.test(attrs)) {
        throw new ValidationError('Links must look like <a href="https://...">text</a>.');
      }
      if (name !== 'a' && attrs.trim() !== '' && !(name === 'code' && /^\s+class="language-[a-z0-9]+"\s*$/.test(attrs))) {
        throw new ValidationError(`Attributes are not allowed on <${name}>.`);
      }
      stack.push(name);
    }
    rest = rest.replace(full, '');
  }
  if (stack.length > 0) throw new ValidationError(`Unclosed tag <${stack[stack.length - 1]}>.`);
  if (/[<>]/.test(rest)) throw new ValidationError('Stray < or > found. Use &lt; and &gt; for literal characters.');
  if (/&(?!(amp|lt|gt|quot);)/.test(rest)) throw new ValidationError('Stray & found. Use &amp; for a literal ampersand.');
}

/** Admin-supplied templates: length, placeholders and HTML are all checked before saving. */
export function validateTemplate(template: string): void {
  if (template.length > MAX_TEMPLATE_LENGTH) throw new ValidationError(`Template is too long (max ${MAX_TEMPLATE_LENGTH} characters).`);
  const unknown = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (!(TEMPLATE_KEYS as readonly string[]).includes(m[1] ?? '')) unknown.add(m[1] ?? '');
  }
  if (unknown.size > 0) {
    throw new ValidationError(`Unknown placeholders: ${[...unknown].join(', ')}\nAllowed: ${TEMPLATE_KEYS.join(', ')}`);
  }
  if (!/\{\{\s*contract\s*\}\}/.test(template)) throw new ValidationError('The template must include {{contract}}.');
  const sample: Record<string, string> = {};
  for (const k of TEMPLATE_KEYS) sample[k] = k === 'description' ? 'x'.repeat(800) : 'x'.repeat(42);
  const rendered = renderTemplate(template, sample);
  if (rendered.length > 4000) throw new ValidationError('Rendered template could exceed Telegram limits. Shorten it.');
  validateTelegramHtml(rendered);
}
