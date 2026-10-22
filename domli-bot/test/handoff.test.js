import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'domli-ho-'));
process.env.KNOWLEDGE_DIR = dir;
process.env.DATA_DIR = dir;
process.env.ACCOUNTS_FILE = join(dir, 'accounts.json');
process.env.ADMIN_TOKEN = 'admin-secret-token';
process.env.BOT_WEBHOOK_SECRET = 'hook-secret';
process.env.ANTHROPIC_API_KEY = 'k'.repeat(30);

const { handleEvent, shouldHandle } = await import('../src/handler.js');
const { detectLanguage } = await import('../src/lang.js');
const { DEFAULTS, firstMatch } = await import('../src/rules.js');
const { updateAccount, listAccounts } = await import('../src/config.js');
const { createLinkAdapter } = await import('../src/appointments/link.js');
const { buildSystemPrompt, parseDecision, askClaude } = await import('../src/ai.js');

const write = account => writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Domli', enabled: true, chatwootBotToken: 'TOKEN-ABCDEFGH', ...account } }));
const event = (content, conversation = { id: 5 }) => ({ event: 'message_created', message_type: 'incoming', content, account: { id: 1 }, conversation });

function mocks() {
  const calls = [];
  return {
    calls,
    chatwoot: {
      handoffToHuman: async () => calls.push('open'),
      assignAgent: async (...a) => calls.push(`assign:${a[3]}`),
      sendReply: async (...a) => calls.push(`reply:${a[3]}`),
      sendNote: async (...a) => calls.push(`note:${a[3]}`),
    },
    askClaude: async () => { calls.push('claude'); return { decision: { action: 'handoff', reply: '' }, usage: { input: 1, output: 1 } }; },
  };
}

test('handoff: opens first, assigns the chosen agent, tells the visitor, then leaves a note', async () => {
  write({ handoffAgentId: 4 });
  const m = mocks();
  assert.equal(await handleEvent(event('Ik heb een klacht over mijn bestelling'), m), 'handoff:klacht');
  assert.deepEqual(m.calls.map(c => c.split(':')[0]), ['open', 'assign', 'reply', 'note']);
  assert.equal(m.calls[1], 'assign:4');
  assert.match(m.calls[2], /medewerker/);
});

test('handoff without a chosen agent only releases the bot (assign nobody)', async () => {
  write({});
  const m = mocks();
  await handleEvent(event('Ik heb een klacht'), m);
  assert.equal(m.calls[1], 'assign:undefined');
});

test('handoff message is in English for English visitors, and English complaints never reach the AI', async () => {
  write({});
  const m = mocks();
  assert.equal(await handleEvent(event('I want to make a complaint about your service'), m), 'handoff:klacht');
  assert.match(m.calls.find(c => c.startsWith('reply:')), /colleague/);
  assert.ok(!m.calls.includes('claude'));
});

test('a failing step does not stop the visitor from being told', async () => {
  write({});
  const m = mocks();
  m.chatwoot.handoffToHuman = async () => { throw new Error('boom'); };
  assert.equal(await handleEvent(event('Ik heb een klacht'), m), 'handoff:klacht');
  assert.ok(m.calls.some(c => c.startsWith('reply:')));
});

test('shouldHandle: pending or bot-held conversations only', () => {
  assert.equal(shouldHandle(undefined), true);
  assert.equal(shouldHandle({ id: 1 }), true);
  assert.equal(shouldHandle({ status: 'pending' }), true);
  assert.equal(shouldHandle({ status: 'open', meta: { assignee_type: 'AgentBot' } }), true);
  assert.equal(shouldHandle({ status: 'open', meta: { assignee: { type: 'agent_bot' } } }), true);
  assert.equal(shouldHandle({ status: 'open', meta: { assignee: { type: 'user' }, assignee_type: 'User' } }), false);
  assert.equal(shouldHandle({ status: 'open', meta: {} }), false);
  assert.equal(shouldHandle({ status: 'resolved' }), false);
});

test('the bot stays out of conversations a human has', async () => {
  write({});
  const m = mocks();
  const human = { id: 5, status: 'open', meta: { assignee: { type: 'user' }, assignee_type: 'User' } };
  assert.equal(await handleEvent(event('Hallo?', human), m), 'human-handling');
  assert.equal(m.calls.length, 0);
});

test('language detection', () => {
  assert.equal(detectLanguage('do you speak english'), 'en');
  assert.equal(detectLanguage('what is your name'), 'en');
  assert.equal(detectLanguage('hey'), 'en');
  assert.equal(detectLanguage('Wat kost het Groei pakket?'), 'nl');
  assert.equal(detectLanguage('hallo, kan ik een afspraak maken'), 'nl');
  assert.equal(detectLanguage('12345'), 'nl');
});

test('default rules: English keywords for prices, complaints, medical, appointments', () => {
  const handoff = text => firstMatch(DEFAULTS.rules, text, 'handoff')?.reason ?? null;
  assert.equal(handoff('How much does it cost?'), 'prijs');
  assert.equal(handoff('What are your prices'), 'prijs');
  assert.equal(handoff('I am very unhappy, this is terrible'), 'klacht');
  assert.equal(handoff('I have a lot of pain after the treatment'), 'medisch');
  assert.equal(handoff('What is the name of the owner of domli'), null);
  assert.equal(handoff('Do you speak english'), null);
  assert.ok(firstMatch(DEFAULTS.rules, 'I would like to book an appointment', 'appointment'));
  assert.equal(firstMatch(DEFAULTS.rules, 'Where can I park?', 'appointment'), null);
});

test('booking link reply follows the visitor language', async () => {
  const adapter = createLinkAdapter({ bookingUrl: 'https://x.nl' });
  assert.match(await adapter.reply({ language: 'en' }), /book an appointment/);
  assert.match(await adapter.reply({ language: 'nl' }), /afspraak inplannen/);
  assert.match(await adapter.reply(), /afspraak/);
});

test('handoffAgentId: set, list, clear, validate', () => {
  write({});
  updateAccount(1, { handoffAgentId: '4' });
  assert.equal(listAccounts()[0].handoffAgentId, 4);
  assert.throws(() => updateAccount(1, { handoffAgentId: 'abc' }), /Ongeldige medewerker/);
  assert.throws(() => updateAccount(1, { handoffAgentId: -2 }), /Ongeldige medewerker/);
  updateAccount(1, { handoffAgentId: '' });
  assert.equal(listAccounts()[0].handoffAgentId, null);
});

test('parseDecision tells a model handoff from an unreadable answer', () => {
  assert.deepEqual(parseDecision('{"action":"answer","reply":"Hoi"}'), { action: 'answer', reply: 'Hoi' });
  assert.deepEqual(parseDecision('{"action":"handoff","reply":""}'), { action: 'handoff', reply: '', reason: 'buiten de kennis' });
  assert.equal(parseDecision('gewoon tekst').reason, 'ongeldig AI-antwoord');
  assert.equal(parseDecision('{"action":"answer","reply":""}').reason, 'ongeldig AI-antwoord');
});

test('quick replies: instant answers from the customer rules, in the visitor language, never handed over', async () => {
  const run = async (mode, text) => {
    write({ mode });
    const m = mocks();
    return { outcome: await handleEvent(event(text), m), calls: m.calls };
  };
  let r = await run('auto', 'do you speak english');
  assert.equal(r.outcome, 'quick-reply');
  assert.deepEqual(r.calls.map(c => c.split(':')[0]), ['reply']);
  assert.match(r.calls[0], /English and Dutch/);
  r = await run('auto', 'spreek je engels?');
  assert.match(r.calls[0], /Ja, ik spreek Nederlands en Engels/);
  r = await run('draft', 'hey');
  assert.equal(r.outcome, 'quick-reply-draft');
  assert.deepEqual(r.calls.map(c => c.split(':')[0]), ['note']);
  // long messages and complaints are not small talk
  r = await run('auto', 'hello, I have a complaint');
  assert.equal(r.outcome, 'handoff:klacht');
  r = await run('auto', 'hello I would like to know more about how the assistant works with whatsapp');
  assert.equal(r.outcome, 'handoff:onzeker');
});

test('askClaude reports why an answer was unusable and logs raw output only when debugging is on', async () => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const reply = (stop_reason, text) => ({ stop_reason, content: text === null ? [] : [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } });
  const ask = async response => {
    const create = Anthropic.Messages.prototype.create;
    Anthropic.Messages.prototype.create = async () => response;
    const logs = [];
    const [warn, log] = [console.warn, console.log];
    console.warn = (...a) => logs.push(a.join(' '));
    console.log = (...a) => logs.push(a.join(' '));
    try {
      return { result: await askClaude({ businessName: 'Domli', rules: [], knowledge: 'k', message: 'hi' }), logs };
    } finally {
      Anthropic.Messages.prototype.create = create;
      [console.warn, console.log] = [warn, log];
    }
  };
  let out = await ask(reply('max_tokens', '{"action":"answer","reply":"half'));
  assert.equal(out.result.decision.reason, 'AI-antwoord afgekapt');
  out = await ask(reply('refusal', null));
  assert.equal(out.result.decision.reason, 'AI weigerde te antwoorden');
  out = await ask(reply('end_turn', '{"action":"answer","reply":"Yes, I speak English!"}'));
  assert.equal(out.result.decision.action, 'answer');
  assert.equal(out.logs.length, 0);
  process.env.DEBUG_AI_OUTPUT = '1';
  out = await ask(reply('end_turn', '{"action":"answer","reply":"Yes!"}'));
  delete process.env.DEBUG_AI_OUTPUT;
  assert.ok(out.logs.some(l => l.startsWith('AI debug:') && l.includes('Yes!')));
});
