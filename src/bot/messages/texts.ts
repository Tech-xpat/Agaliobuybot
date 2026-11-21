import { escapeHtml } from '../../utils/sanitizers';

export const SAFETY_FOOTER =
  '<i>AGALIO BuyBot never asks for seed phrases or private keys, never holds funds and never trades for you. Admins will never DM you first.</i>';

export function startText(): string {
  return [
    '<b>AGALIO BUYBOT</b>',
    'I post the official AGALIO token information when the official contract address is shared in AGALIO NETWORK.',
    '',
    'Just type <b>CA</b> in the group (or here) and I will post the contract and token details. No commands needed.',
    '',
    SAFETY_FOOTER,
  ].join('\n');
}

export function helpText(isAdmin: boolean): string {
  const lines = [
    '<b>Commands</b>',
    'Type <b>CA</b> (or "wen ca", "contract address") to get the token card and contract. Commands also work:',
    '/token – show the AGALIO token card',
    '/contract – official contract address (tap to copy)',
    '/help – this message',
  ];
  if (isAdmin) {
    lines.push(
      '',
      '<b>Admin</b>',
      'Send /start in a private chat to open the <b>button-based admin panel</b>. Everything below is an optional shortcut.',
      '',
      '<b>Shortcut commands (private chat only)</b>',
      '/status – health and configuration',
      '/announcement – preview the announcement here',
      '/test – post a TEST announcement in the group',
      '/refresh – refresh on-chain and market data',
      '/setcontract &lt;0x…&gt; [confirm] [force]',
      '/setbuyurl &lt;https://…|clear&gt;',
      '/setcharturl &lt;https://…|clear&gt;',
      '/setcommunity &lt;https://…|clear&gt;',
      '/setwebsite &lt;https://…|clear&gt;',
      '/setlink &lt;twitter|whitepaper|tokenomics|security&gt; &lt;url|clear&gt;',
      '/setdescription &lt;text&gt;',
      '/setlaunchstatus &lt;status&gt;',
      '/setlogo (reply to a photo, or send a URL, or "clear")',
      '/buttons [key on|off]',
      '/settemplate &lt;telegram HTML&gt; · /resettemplate',
      '/pause · /resume',
      '/admins · /addadmin &lt;id&gt; · /removeadmin &lt;id&gt;',
    );
  }
  lines.push('', SAFETY_FOOTER);
  return lines.join('\n');
}

export function plain(text: string): string {
  return escapeHtml(text);
}
