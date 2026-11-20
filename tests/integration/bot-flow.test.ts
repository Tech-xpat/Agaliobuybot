import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_ID, MEMBER_ID, OFFICIAL, OTHER, marketData } from '../fixtures';
import { TEST_DB, createHarness, type Harness } from './harness';

describe.skipIf(!TEST_DB)('bot end-to-end (real Postgres, mocked Telegram/BSC/DexScreener)', () => {
  let h: Harness;
  beforeEach(async () => {
    if (h) await h.close();
    h = await createHarness();
  });
  afterAll(async () => h?.close());

  const keyboardOf = (call: { payload: Record<string, unknown> }) =>
    ((call.payload.reply_markup as { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] }).inline_keyboard).flat();

  it('announces when a member posts the official contract in ordinary text', async () => {
    await h.groupMessage(`gm frens 🚀 AGALIO CA: ${OFFICIAL.toLowerCase()} lfg`);
    const [call] = h.sent();
    expect(call?.method).toBe('sendMessage');
    expect(call?.payload.chat_id).toBe(-1001234567890);
    expect(call?.payload.parse_mode).toBe('HTML');
    expect(String(call?.payload.text)).toContain(OFFICIAL);
    expect((call?.payload.reply_parameters as { message_id: number }).message_id).toBe(100);
    const labels = keyboardOf(call!).map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(['📋 COPY CONTRACT', 'ℹ️ TOKEN DETAILS', '🔍 BSC SCAN']));
    expect(labels).not.toContain('🟢 BUY AGALIO'); // no buy URL, not live
  });

  it('ignores a random contract and unrelated chatter', async () => {
    await h.groupMessage(`ape into ${OTHER}`);
    await h.groupMessage('hello everyone');
    expect(h.sent()).toHaveLength(0);
  });

  it('ignores the official contract posted in a different chat', async () => {
    await h.send({ message: { message_id: 1, date: 1, chat: { id: -100999, type: 'supergroup', title: 'Other' }, from: { id: 5, is_bot: false, first_name: 'x' }, text: OFFICIAL } });
    expect(h.sent()).toHaveLength(0);
  });

  it('does not announce twice for the same message (edit) and respects cooldown for others', async () => {
    await h.groupMessage(OFFICIAL, 200);
    await h.send({ edited_message: { message_id: 200, date: 1, edit_date: 2, chat: { id: -1001234567890, type: 'supergroup' }, from: { id: MEMBER_ID, is_bot: false, first_name: 'x' }, text: `${OFFICIAL} edited` } });
    await h.groupMessage(OFFICIAL, 201);
    expect(h.sent()).toHaveLength(1);
  });

  it('persists the announcement and detection records', async () => {
    await h.groupMessage(OFFICIAL, 300);
    expect(await h.db.announcement.count()).toBe(1);
    const det = await h.db.detectedMessage.findFirstOrThrow();
    expect(det).toMatchObject({ messageId: 300, matched: true, contract: OFFICIAL.toLowerCase() });
  });

  it('does not announce while paused, then resumes', async () => {
    await h.privateCommand('pause');
    await h.groupMessage(OFFICIAL, 400);
    expect(h.sent().filter((c) => c.payload.chat_id === -1001234567890)).toHaveLength(0);
    await h.privateCommand('resume');
    await h.groupMessage(OFFICIAL, 401);
    expect(h.sent().filter((c) => c.payload.chat_id === -1001234567890)).toHaveLength(1);
  });

  it('shows live data when the provider has a pair, and honest placeholders when it does not', async () => {
    await h.groupMessage(OFFICIAL, 500);
    expect(String(h.sent()[0]!.payload.text)).toContain('Price: Data currently unavailable');

    await h.close();
    h = await createHarness();
    h.setMarket(marketData);
    await h.groupMessage(OFFICIAL, 501);
    expect(String(h.sent()[0]!.payload.text)).toContain('$0.000123');
    expect(keyboardOf(h.sent()[0]!).map((b) => b.text)).toContain('📈 LIVE CHART');
  });

  it('still announces when market data AND on-chain RPC are down', async () => {
    h.setMarket(new Error('dexscreener down'));
    h.setOnchain(null);
    await h.groupMessage(OFFICIAL, 600);
    const text = String(h.sent()[0]!.payload.text);
    expect(text).toContain(OFFICIAL);
    expect(text).toContain('Data currently unavailable');
  });

  it('COPY CONTRACT callback posts a monospace, copy-friendly message from the DB (not callback data)', async () => {
    await h.callback('c:copy');
    const msg = h.calls.find((c) => c.method === 'sendMessage');
    expect(String(msg?.payload.text)).toContain(`<code>${OFFICIAL}</code>`);
    expect(h.calls.find((c) => c.method === 'answerCallbackQuery')).toBeTruthy();
  });

  it('COPY CONTRACT callback is rate limited per chat so it cannot spam the group', async () => {
    await h.callback('c:copy');
    await h.callback('c:copy', 3003);
    expect(h.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);
  });

  it('TOKEN DETAILS callback posts the details page', async () => {
    await h.callback('c:details');
    expect(String(h.calls.find((c) => c.method === 'sendMessage')?.payload.text)).toContain('On-chain facts');
  });

  it('unknown callback data is acknowledged and ignored', async () => {
    await h.callback('c:evil');
    expect(h.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });

  it('survives an expired callback query', async () => {
    h.failNext('answerCallbackQuery', { error_code: 400, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' });
    await expect(h.callback('c:copy')).resolves.toBeUndefined();
  });

  it('Telegram 429 on announcement: no crash, a retry job is scheduled', async () => {
    h.failNext('sendMessage', { error_code: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } });
    await h.groupMessage(OFFICIAL, 700);
    expect(h.retryJobs).toHaveBeenCalledWith({ chatId: '-1001234567890', replyTo: 700, kind: 'AUTO' }, 3000);
    expect(await h.db.botEvent.count({ where: { type: 'announcement.failed' } })).toBe(1);
  });

  it('Telegram permanent error (bot lacks rights): logged, not retried, not crashed', async () => {
    h.failNext('sendMessage', { error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' });
    await h.groupMessage(OFFICIAL, 701);
    expect(h.retryJobs).not.toHaveBeenCalled();
  });

  it('falls back to a text announcement if the logo cannot be sent', async () => {
    const token = await h.db.token.findFirstOrThrow();
    await h.db.token.update({ where: { id: token.id }, data: { logoFileId: 'BROKEN' } });
    h.failNext('sendPhoto', { error_code: 400, description: 'Bad Request: wrong file identifier/HTTP URL specified' });
    await h.groupMessage(OFFICIAL, 800);
    expect(h.calls.some((c) => c.method === 'sendMessage')).toBe(true);
    expect((await h.db.token.findFirstOrThrow()).logoFileId).toBeNull();
  });

  it('sends photo + caption + buttons when a logo is set and the text fits', async () => {
    const token = await h.db.token.findFirstOrThrow();
    await h.db.token.update({ where: { id: token.id }, data: { logoFileId: 'LOGO_FILE_ID' } });
    await h.db.botConfiguration.update({ where: { id: 1 }, data: { announcementTemplate: '<b>{{symbol}}</b> <code>{{contract}}</code>' } });
    await h.groupMessage(OFFICIAL, 801);
    const photo = h.calls.find((c) => c.method === 'sendPhoto');
    expect(photo?.payload.photo).toBe('LOGO_FILE_ID');
    expect(String(photo?.payload.caption)).toContain(OFFICIAL);
    expect(photo?.payload.reply_markup).toBeTruthy();
  });

  describe('administration', () => {
    it('rejects admin commands from ordinary members and changes nothing', async () => {
      await h.privateCommand('setbuyurl', 'https://pancakeswap.finance/swap', MEMBER_ID);
      await h.privateCommand('setlaunchstatus', 'TRADING_LIVE', MEMBER_ID);
      await h.privateCommand('setcontract', OTHER, MEMBER_ID, {});
      expect(h.calls.filter((c) => c.method === 'sendMessage').every((c) => String(c.payload.text).includes('not authorized'))).toBe(true);
      const t = await h.db.token.findFirstOrThrow();
      expect(t.buyUrl).toBeNull();
      expect(t.launchStatus).toBe('PRE_LAUNCH');
      expect((await h.db.contractAddress.findFirstOrThrow({ where: { isOfficial: true } })).checksum).toBe(OFFICIAL);
      expect(await h.db.auditLog.count()).toBe(0);
    });

    it('ordinary members get no reaction to admin commands inside the group', async () => {
      await h.send({ message: { message_id: 9, date: 1, chat: { id: -1001234567890, type: 'supergroup' }, from: { id: MEMBER_ID, is_bot: false, first_name: 'x' }, text: '/pause', entities: [{ type: 'bot_command', offset: 0, length: 6 }] } });
      expect(h.sent()).toHaveLength(0);
      expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).paused).toBe(false);
    });

    it('admins are told to use private chat when they try in the group', async () => {
      await h.send({ message: { message_id: 9, date: 1, chat: { id: -1001234567890, type: 'supergroup' }, from: { id: ADMIN_ID, is_bot: false, first_name: 'a' }, text: '/status', entities: [{ type: 'bot_command', offset: 0, length: 7 }] } });
      expect(String(h.sent()[0]!.payload.text)).toContain('private chat');
      expect(String(h.sent()[0]!.payload.text)).not.toContain('Database');
    });

    it('admin can configure URLs, status, description, buttons; each change is audited', async () => {
      await h.privateCommand('setlaunchstatus', 'trading live');
      await h.privateCommand('setbuyurl', 'https://pancakeswap.finance/swap?chain=bsc&outputCurrency={contract}');
      await h.privateCommand('setcharturl', 'https://dexscreener.com/bsc/{contract}');
      await h.privateCommand('setcommunity', 'https://t.me/agalio_holders');
      await h.privateCommand('setdescription', 'The <b>official</b> AGALIO token.');
      await h.privateCommand('buttons', 'bscscan off');
      const t = await h.db.token.findFirstOrThrow();
      expect(t).toMatchObject({ launchStatus: 'TRADING_LIVE', communityUrl: 'https://t.me/agalio_holders' });
      expect(await h.db.auditLog.count()).toBeGreaterThanOrEqual(6);

      await h.groupMessage(OFFICIAL, 900);
      const call = h.sent().find((c) => c.payload.chat_id === -1001234567890)!;
      const kb = keyboardOf(call);
      expect(kb.find((b) => b.text.includes('BUY'))?.url).toBe(`https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${OFFICIAL}`);
      expect(kb.find((b) => b.text.includes('CHART'))?.url).toBe(`https://dexscreener.com/bsc/${OFFICIAL}`);
      expect(kb.map((b) => b.text)).not.toContain('🔍 BSC SCAN');
      expect(String(call.payload.text)).toContain('TRADING LIVE');
      expect(String(call.payload.text)).toContain('&lt;b&gt;official&lt;/b&gt;'); // description is escaped, not interpreted
    });

    it('rejects invalid URLs with a clear message and stores nothing', async () => {
      await h.privateCommand('setbuyurl', 'javascript:alert(1)');
      await h.privateCommand('setbuyurl', 'http://insecure.example/swap');
      expect(String(h.sent().at(-1)!.payload.text)).toContain('https');
      expect((await h.db.token.findFirstOrThrow()).buyUrl).toBeNull();
    });

    it('/setcontract requires confirmation to replace, verifies code on-chain, and normalises', async () => {
      await h.privateCommand('setcontract', OTHER.toLowerCase());
      expect(String(h.sent().at(-1)!.payload.text)).toContain('confirm');
      expect((await h.db.contractAddress.findFirstOrThrow({ where: { isOfficial: true } })).checksum).toBe(OFFICIAL);

      h.setOnchain({ ...(await h.deps.tokenSvc.getOnChain(OFFICIAL))!, hasCode: false });
      await h.privateCommand('setcontract', `${OTHER} confirm`);
      expect(String(h.sent().at(-1)!.payload.text)).toContain('No contract code');

      await h.privateCommand('setcontract', `${OTHER} confirm force`);
      const official = await h.db.contractAddress.findMany({ where: { isOfficial: true } });
      expect(official).toHaveLength(1);
      expect(official[0]).toMatchObject({ checksum: OTHER, address: OTHER.toLowerCase() });

      // the old contract no longer triggers announcements
      await h.groupMessage(OFFICIAL, 950);
      expect(h.sent().filter((c) => c.payload.chat_id === -1001234567890)).toHaveLength(0);
    });

    it('/setcontract rejects malformed addresses', async () => {
      await h.privateCommand('setcontract', '0x1234');
      expect(String(h.sent().at(-1)!.payload.text)).toMatch(/valid EVM address/);
    });

    it('custom templates are validated and used; reset restores the default', async () => {
      await h.privateCommand('settemplate', '<script>x</script>{{contract}}');
      expect(String(h.sent().at(-1)!.payload.text)).toContain('not allowed');
      await h.privateCommand('settemplate', '<b>{{symbol}}</b> {{contract}}');
      expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).announcementTemplate).toContain('{{symbol}}');
      await h.privateCommand('resettemplate');
      expect((await h.db.botConfiguration.findUniqueOrThrow({ where: { id: 1 } })).announcementTemplate).toBeNull();
    });

    it('/test posts a labelled TEST announcement to the group; /announcement previews privately', async () => {
      await h.privateCommand('test');
      const groupMsg = h.sent().find((c) => String(c.payload.chat_id) === '-1001234567890');
      expect(String(groupMsg?.payload.text)).toContain('TEST ANNOUNCEMENT');
      await h.privateCommand('announcement');
      const dm = h.sent().find((c) => c.payload.chat_id === ADMIN_ID && String(c.payload.text).includes('PREVIEW'));
      expect(dm).toBeTruthy();
    });

    it('/status reports health without leaking secrets', async () => {
      await h.privateCommand('status');
      const text = String(h.sent().at(-1)!.payload.text);
      expect(text).toContain('Database: ✅');
      expect(text).toContain('rpc.test');
      expect(text).not.toMatch(/\d{6,12}:[A-Za-z0-9_-]{30,}/);
      expect(text).not.toContain('postgresql://');
    });

    it('primary admin can add and remove a DB admin; DB admin can configure but not manage admins', async () => {
      await h.privateCommand('addadmin', '3003');
      await h.privateCommand('setlaunchstatus', 'CONTRACT_DEPLOYED', 3003);
      expect((await h.db.token.findFirstOrThrow()).launchStatus).toBe('CONTRACT_DEPLOYED');
      await h.privateCommand('addadmin', '4004', 3003);
      expect(await h.db.administrator.count({ where: { telegramId: 4004n } })).toBe(0);
      await h.privateCommand('removeadmin', '3003');
      await h.privateCommand('setlaunchstatus', 'PAUSED', 3003);
      expect((await h.db.token.findFirstOrThrow()).launchStatus).toBe('CONTRACT_DEPLOYED');
    });
  });

  describe('no official contract configured yet', () => {
    it('never announces, and /contract says so', async () => {
      await h.close();
      h = await createHarness({ seedContract: false });
      await h.groupMessage(OFFICIAL, 1);
      expect(h.sent()).toHaveLength(0);
      await h.privateCommand('contract', '', MEMBER_ID);
      expect(String(h.sent().at(-1)!.payload.text)).toContain('not been announced');
    });
  });
});
