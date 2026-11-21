import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_ID, MEMBER_ID, OFFICIAL, OTHER, marketData } from '../fixtures';
import { TEST_DB, createHarness, type Harness } from './harness';

const GROUP = '-1001234567890';
const toGroup = (h: Harness) => h.sent().filter((c) => String(c.payload.chat_id) === GROUP);
const buttons = (call?: { payload: Record<string, unknown> }) =>
  ((call?.payload.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();

describe.skipIf(!TEST_DB)('"ca" keyword in the group (no slash commands)', () => {
  let h: Harness;
  beforeEach(async () => {
    if (h) await h.close();
    h = await createHarness();
  });
  afterAll(async () => h?.close());

  it('replies with ONLY the contract address when a member just types "ca"', async () => {
    await h.groupMessage('ca', 10);
    const [call] = toGroup(h);
    expect(call?.method).toBe('sendMessage');
    expect(String(call?.payload.text)).toBe(`<code>${OFFICIAL}</code>`);
    expect(buttons(call)).toHaveLength(0);
    expect((call?.payload.reply_parameters as { message_id: number }).message_id).toBe(10);
  });

  it.each(['CA?', 'wen ca', "what's the ca", 'contract address pls'])('also answers "%s"', async (text) => {
    await h.groupMessage(text, 11);
    expect(toGroup(h)).toHaveLength(1);
  });

  it('does not react to ordinary sentences containing "ca"', async () => {
    await h.groupMessage('my ca is going 10x', 12);
    await h.groupMessage('hello', 13);
    expect(toGroup(h)).toHaveLength(0);
  });

  it('is rate limited: one answer per chat per 30s, even from different users', async () => {
    await h.groupMessage('ca', 20, MEMBER_ID);
    await h.groupMessage('ca', 21, 3003);
    await h.groupMessage('ca', 22, MEMBER_ID);
    expect(toGroup(h)).toHaveLength(1);
  });

  it('is silent while paused, and when no contract is set', async () => {
    await h.panelPress('a:pause');
    await h.groupMessage('ca', 30);
    expect(toGroup(h)).toHaveLength(0);
    await h.close();
    h = await createHarness({ seedContract: false });
    await h.groupMessage('ca', 31);
    expect(toGroup(h)).toHaveLength(0);
  });

  it('ignores "ca" in other chats', async () => {
    await h.send({ message: { message_id: 1, date: 1, chat: { id: -100999, type: 'supergroup', title: 'x' }, from: { id: 5, is_bot: false, first_name: 'x' }, text: 'ca' } });
    expect(h.sent()).toHaveLength(0);
  });

  it('answers "ca" in a private chat with the bot too', async () => {
    await h.privateText('ca', MEMBER_ID);
    expect(String(h.last('sendMessage')?.payload.text)).toContain(OFFICIAL);
  });
});

describe.skipIf(!TEST_DB)('individual stat questions in the group', () => {
  let h: Harness;
  beforeEach(async () => {
    if (h) await h.close();
    h = await createHarness();
    h.setMarket(marketData);
  });
  afterAll(async () => h?.close());

  it('"price" answers with only the price', async () => {
    await h.groupMessage('price', 50);
    const [call] = toGroup(h);
    const text = String(call?.payload.text);
    expect(text).toContain('$0.000123');
    expect(text).not.toContain('Market cap');
    expect(text).not.toContain(OFFICIAL);
    expect((call?.payload.reply_parameters as { message_id: number }).message_id).toBe(50);
  });

  it('"mc" and "liquidity" each answer individually', async () => {
    await h.groupMessage('mc', 51, MEMBER_ID);
    await h.groupMessage('liquidity', 52, 3003);
    const texts = toGroup(h).map((c) => String(c.payload.text));
    expect(texts[0]).toContain('Market cap');
    expect(texts[0]).not.toContain('Liquidity');
    expect(texts[1]).toContain('Liquidity');
    expect(texts[1]).not.toContain('Market cap');
  });

  it('is rate limited per user and ignores ordinary sentences', async () => {
    await h.groupMessage('price', 53, MEMBER_ID);
    await h.groupMessage('mc', 54, MEMBER_ID);
    await h.groupMessage('the price is dumping', 55, 3003);
    expect(toGroup(h)).toHaveLength(1);
  });

  it('is silent while paused', async () => {
    await h.panelPress('a:pause');
    await h.groupMessage('price', 56);
    expect(toGroup(h)).toHaveLength(0);
  });
});

describe.skipIf(!TEST_DB)('button-based admin panel', () => {
  let h: Harness;
  beforeEach(async () => {
    if (h) await h.close();
    h = await createHarness();
  });
  afterAll(async () => h?.close());

  const edited = () => String(h.last('editMessageText')?.payload.text ?? '');

  it('/start opens the panel for admins; ordinary users just get the intro', async () => {
    await h.privateCommand('start');
    expect(String(h.last('sendMessage')?.payload.text)).toContain('Admin Panel');
    expect(buttons(h.last('sendMessage')).map((b) => b.text)).toEqual(expect.arrayContaining(['🚦 Launch status', '🔗 Links', '🔘 Buttons', '📜 Contract']));
    await h.privateCommand('start', '', MEMBER_ID);
    expect(String(h.last('sendMessage')?.payload.text)).not.toContain('Admin Panel');
  });

  it('any plain message from an admin in private opens the panel', async () => {
    await h.privateText('hello');
    expect(String(h.last('sendMessage')?.payload.text)).toContain('Admin Panel');
    const before = h.calls.length;
    await h.privateText('hello', MEMBER_ID); // a non-admin gets no panel and no reply at all
    expect(h.calls.length).toBe(before);
  });

  it('SECURITY: a non-admin pressing admin buttons changes nothing', async () => {
    for (const data of ['a:ls:TRADING_LIVE', 'a:pause', 'a:bt:buy', 'a:lkc:buy', 'a:tpr', 'a:adadd', 'a:testgo', 'a:lgc']) await h.panelPress(data, MEMBER_ID);
    const t = await h.db.token.findFirstOrThrow();
    expect(t.launchStatus).toBe('PRE_LAUNCH');
    expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).paused).toBe(false);
    expect(await h.db.auditLog.count()).toBe(0);
    expect(h.calls.filter((c) => c.method === 'answerCallbackQuery').every((c) => c.payload.show_alert === true)).toBe(true);
    expect(toGroup(h)).toHaveLength(0);
  });

  it('SECURITY: admin buttons do nothing when pressed from the group chat', async () => {
    await h.send({ callback_query: { id: 'g1', from: { id: ADMIN_ID, is_bot: false, first_name: 'a' }, chat_instance: 'c', data: 'a:ls:TRADING_LIVE', message: { message_id: 1, date: 1, chat: { id: -1001234567890, type: 'supergroup' } } } });
    expect((await h.db.token.findFirstOrThrow()).launchStatus).toBe('PRE_LAUNCH');
  });

  it('admin sets the launch status by tapping a button', async () => {
    await h.panelPress('a:ls');
    expect(buttons(h.last('editMessageText')).map((b) => b.text)).toContain('TRADING LIVE');
    await h.panelPress('a:ls:TRADING_LIVE');
    expect((await h.db.token.findFirstOrThrow()).launchStatus).toBe('TRADING_LIVE');
    expect(edited()).toContain('No buy URL is set');
    expect(await h.db.auditLog.count({ where: { action: 'launch_status.set' } })).toBe(1);
  });

  it('admin sets a link: tap → bot asks → admin types the URL → saved and audited', async () => {
    await h.panelPress('a:lk');
    await h.panelPress('a:lk:buy');
    await h.panelPress('a:lkset:buy');
    expect(edited()).toContain('Send the new');
    await h.privateText('https://pancakeswap.finance/swap?chain=bsc&outputCurrency={contract}');
    expect((await h.db.token.findFirstOrThrow()).buyUrl).toBe('https://pancakeswap.finance/swap?chain=bsc&outputCurrency={contract}');
    expect(String(h.last('sendMessage')?.payload.text)).toContain('saved');
    expect(await h.db.auditLog.count({ where: { action: 'url.buyUrl' } })).toBe(1);
  });

  it('an invalid link is rejected, the prompt stays open, and a corrected one works', async () => {
    await h.panelPress('a:lkset:website');
    await h.privateText('http://insecure.example');
    expect(String(h.last('sendMessage')?.payload.text)).toContain('https');
    expect((await h.db.token.findFirstOrThrow()).websiteUrl).toBeNull();
    await h.privateText('https://agalio.example');
    expect((await h.db.token.findFirstOrThrow()).websiteUrl).toBe('https://agalio.example');
  });

  it('a link can be removed with one tap', async () => {
    await h.db.token.updateMany({ data: { websiteUrl: 'https://agalio.example' } });
    await h.panelPress('a:lkc:website');
    expect((await h.db.token.findFirstOrThrow()).websiteUrl).toBeNull();
  });

  it('typed text is NOT treated as input when no prompt is pending, and prompts expire on cancel', async () => {
    await h.panelPress('a:lkset:website');
    await h.panelPress('a:cancel');
    await h.privateText('https://agalio.example');
    expect((await h.db.token.findFirstOrThrow()).websiteUrl).toBeNull();
  });

  it('a non-admin cannot complete someone else’s prompt', async () => {
    await h.panelPress('a:dsset');
    await h.privateText('hacked description', MEMBER_ID);
    expect((await h.db.token.findFirstOrThrow()).description).toBe('');
  });

  it('buttons are toggled by tapping them', async () => {
    await h.panelPress('a:bt:copy');
    expect(edited()).toContain('copy</b> is now OFF');
    await h.groupMessage(OFFICIAL, 40);
    expect(buttons(toGroup(h)[0]).map((b) => b.text)).not.toContain('📋 COPY CONTRACT');
    await h.panelPress('a:bt:copy');
    expect(edited()).toContain('is now ON');
  });

  it('pause / resume is one toggle button', async () => {
    await h.panelPress('a:pause');
    expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).paused).toBe(true);
    expect(edited()).toContain('paused');
    await h.panelPress('a:pause');
    expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).paused).toBe(false);
  });

  it('description via button + typed text', async () => {
    await h.panelPress('a:dsset');
    await h.privateText('The official AGALIO token.');
    expect((await h.db.token.findFirstOrThrow()).description).toBe('The official AGALIO token.');
  });

  it('logo via button + photo', async () => {
    await h.panelPress('a:lgset');
    await h.privatePhoto();
    expect((await h.db.token.findFirstOrThrow()).logoFileId).toBe('PHOTO_BIG');
  });

  it('template via button; invalid template is rejected, valid saved, reset by button', async () => {
    await h.panelPress('a:tpset');
    await h.privateText('<script>x</script>{{contract}}');
    expect(String(h.last('sendMessage')?.payload.text)).toContain('not allowed');
    await h.privateText('<b>{{symbol}}</b> <code>{{contract}}</code>');
    expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).announcementTemplate).toContain('{{symbol}}');
    await h.panelPress('a:tpr');
    expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).announcementTemplate).toBeNull();
  });

  it('contract: replacing asks for confirmation by button, then checks code, offers "set anyway"', async () => {
    await h.panelPress('a:ctset');
    await h.privateText(OTHER);
    expect(buttons(h.last('sendMessage')).map((b) => b.text)).toContain('✅ Yes, replace it');
    expect((await h.db.contractAddress.findFirstOrThrow({ where: { isOfficial: true } })).checksum).toBe(OFFICIAL); // unchanged so far

    await h.panelPress('a:ctok');
    expect((await h.db.contractAddress.findFirstOrThrow({ where: { isOfficial: true } })).checksum).toBe(OTHER);
  });

  it('contract with no on-chain code requires an explicit "Set anyway" tap', async () => {
    h.setOnchain({ address: OTHER, hasCode: false, name: null, symbol: null, decimals: null, totalSupply: null, fetchedAt: 1, failedFields: [] });
    await h.panelPress('a:ctset');
    await h.privateText(OTHER);
    await h.panelPress('a:ctok');
    expect(buttons(h.last('editMessageText')).map((b) => b.text)).toContain('⚠️ Set anyway');
    expect((await h.db.contractAddress.findFirstOrThrow({ where: { isOfficial: true } })).checksum).toBe(OFFICIAL);
    await h.panelPress('a:ctforce');
    expect((await h.db.contractAddress.findFirstOrThrow({ where: { isOfficial: true } })).checksum).toBe(OTHER);
  });

  it('contract: malformed address is rejected with the prompt kept open', async () => {
    await h.panelPress('a:ctset');
    await h.privateText('0x1234');
    expect(String(h.last('sendMessage')?.payload.text)).toMatch(/valid EVM address/);
    expect((await h.db.contractAddress.findFirstOrThrow({ where: { isOfficial: true } })).checksum).toBe(OFFICIAL);
  });

  it('test post needs a confirming tap, then posts a TEST card in the group', async () => {
    await h.panelPress('a:test');
    expect(toGroup(h)).toHaveLength(0);
    await h.panelPress('a:testgo');
    expect(String(toGroup(h)[0]?.payload.text)).toContain('TEST ANNOUNCEMENT');
  });

  it('preview and status screens work', async () => {
    await h.panelPress('a:preview');
    expect(String(h.sent().at(-1)?.payload.text)).toContain('PREVIEW');
    await h.panelPress('a:status');
    expect(edited()).toContain('Database: ✅');
  });

  it('only primary admins see add/remove admin buttons and can use them', async () => {
    await h.panelPress('a:adadd');
    await h.privateText('3003');
    expect(await h.db.administrator.count({ where: { telegramId: 3003n } })).toBe(1);
    await h.panelPress('a:ad', 3003);
    expect(buttons(h.last('editMessageText')).map((b) => b.text)).not.toContain('➕ Add admin');
    await h.panelPress('a:adadd', 3003);
    await h.privateText('4004', 3003);
    expect(await h.db.administrator.count({ where: { telegramId: 4004n } })).toBe(0);
  });

  it('every panel callback is acknowledged (no spinner left hanging)', async () => {
    const before = h.calls.filter((c) => c.method === 'answerCallbackQuery').length;
    await h.panelPress('a:menu');
    await h.panelPress('a:bt');
    expect(h.calls.filter((c) => c.method === 'answerCallbackQuery').length - before).toBe(2);
  });
});
