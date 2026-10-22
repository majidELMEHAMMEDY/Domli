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

const { handleEvent, shouldHandle } = await import('../src/handler.js');
const { detectLanguage } = await import('../src/lang.js');
const { checkHandoff, isAppointmentIntent } = await import('../src/guard.js');
const { updateAccount, listAccounts } = await import('../src/config.js');
const { createLinkAdapter } = await import('../src/appointments/link.js');
const { buildSystemPrompt } = await import('../src/ai.js');

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
  assert.equal(detectLanguage('Wat kost het Groei pakket?'), 'nl');
  assert.equal(detectLanguage('hallo, kan ik een afspraak maken'), 'nl');
  assert.equal(detectLanguage('12345'), 'nl');
});

test('English keywords: prices, complaints, medical, appointments', () => {
  assert.equal(checkHandoff('How much does it cost?'), 'prijs');
  assert.equal(checkHandoff('What are your prices'), 'prijs');
  assert.equal(checkHandoff('I am very unhappy, this is terrible'), 'klacht');
  assert.equal(checkHandoff('I have a lot of pain after the treatment'), 'medisch');
  assert.equal(checkHandoff('What is the name of the owner of domli'), null);
  assert.equal(checkHandoff('Do you speak english'), null);
  assert.equal(checkHandoff('What are your prices', { skip: ['prijs'] }), null);
  assert.equal(checkHandoff('I want to complain', { skip: ['prijs'] }), 'klacht');
  assert.equal(isAppointmentIntent('I would like to book an appointment'), true);
  assert.equal(isAppointmentIntent('Where can I park?'), false);
});

test('booking link reply follows the visitor language', async () => {
  const adapter = createLinkAdapter({ bookingUrl: 'https://x.nl' });
  assert.match(await adapter.reply({ language: 'en' }), /book an appointment/);
  assert.match(await adapter.reply({ language: 'nl' }), /afspraak inplannen/);
  assert.match(await adapter.reply(), /afspraak/);
});

test('the prompt asks for the visitor language and keeps the safety rules before owner instructions', () => {
  const prompt = buildSystemPrompt('Domli', 'kennis', { instructions: 'Je heet Mila.' });
  assert.match(prompt, /Nederlands of Engels/);
  assert.ok(prompt.indexOf('Kies "handoff"') < prompt.indexOf('<instructies>'));
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

test('small talk is answered by the assistant, not handed over: the prompt says so and keeps handoff for real unknowns', () => {
  const prompt = buildSystemPrompt('Domli', 'kennis');
  assert.match(prompt, /spreek je Engels/);
  assert.match(prompt, /Gewoon gesprek beantwoord je zelf/);
  assert.match(prompt, /een inhoudelijke vraag over het bedrijf niet in de kennis staat/);
  // the old over-eager rule must be gone
  assert.ok(!prompt.includes('niet in de kennis staat of je twijfelt'));
  // safety rules still present
  assert.match(prompt, /klacht/);
  assert.match(prompt, /gezondheid/);
});

test('a model handoff and an unparseable answer are told apart in the reason', async () => {
  const { parseDecision } = await import('../src/ai.js');
  assert.deepEqual(parseDecision('{"action":"handoff","reply":""}'), { action: 'handoff', reply: '', reason: 'buiten de kennis' });
  assert.equal(parseDecision('gewoon tekst zonder json').reason, 'ongeldig AI-antwoord');
  assert.equal(parseDecision('{"action":"answer","reply":""}').reason, 'ongeldig AI-antwoord');
  write({});
  const m = mocks();
  m.askClaude = async () => ({ decision: parseDecision('{"action":"handoff"}'), usage: { input: 1, output: 1 } });
  assert.equal(await handleEvent(event('Wie is de eigenaar van het bedrijf?'), m), 'handoff:buiten de kennis');
});
