const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(input: string): string {
  return escapeHtml(input).replace(/"/g, '&quot;');
}

export function stripInvisible(input: string): string {
  return input.replace(ZERO_WIDTH, '');
}

/** Plain-text cleanup for admin-supplied free text. */
export function cleanText(input: string, maxLength: number): string {
  return stripInvisible(input).replace(CONTROL, '').trim().slice(0, maxLength);
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 1))}…`;
}

/** Split long text at newline boundaries so each part fits Telegram limits. */
export function splitMessage(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > limit && current) {
      parts.push(current);
      current = line.slice(0, limit);
    } else {
      current = current ? `${current}\n${line}` : line.slice(0, limit);
    }
  }
  if (current) parts.push(current);
  return parts;
}
