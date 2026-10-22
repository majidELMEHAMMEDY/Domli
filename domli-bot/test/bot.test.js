import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'domli-bot-'));
process.env.ACCOUNTS_FILE = join(dir, 'accounts.json');
process.env.DATA_DIR = dir;
process.env.KNOWLEDGE_DIR = dir;

const { checkHandoff, isAppointmentIntent } = await import('../src/guard.js');
const { parseDecision } = await import('../src/ai.js');
const { sign } = await import('../src/appointments/onlineafspraken.js');
const { handleEvent } = await import('../src/handler.js');
const { tokensUsed } = await import('../src/usage.js');

const writeAccounts = overrides =>
  writeFileSync(
    process.env.ACCOUNTS_FILE,
    JSON.stringify({
      1: {
        businessName: 'Test',
        enabled: true,
        chatwootBotToken: 't',
        appointments: { provider: 'link', bookingUrl: 'https://x.onlineafspraken.nl' },
        ...overrides,
      },
    })
  );

const event = content => ({
  event: 'message_created',
  message_type: 'incoming',
  content,
  account: { id: 1 },
  conversation: { id: 9 },
});

function mocks(decision = { action: 'answer', reply: 'Wij zijn open van 9 tot 18.' }) {
  const calls = [];
  return {
    calls,
    chatwoot: {
      sendReply: async (...a) => calls.push(['reply', a[3]]),
      sendNote: async (...a) => calls.push(['note', a[3]]),
      handoffToHuman: async () => calls.push(['handoff']),
      assignAgent: async () => calls.push(['assign']),
    },
    askClaude: async () => {
      calls.push(['claude']);
      return { decision, usage: { input: 100, output: 20 } };
    },
  };
}

test('guard hands off prices, complaints and medical topics', () => {
  assert.equal(checkHandoff('Wat kost een knipbeurt?'), 'prijs');
  assert.equal(checkHandoff('Wat zijn de prijzen?'), 'prijs');
  assert.equal(checkHandoff('Ik heb een klacht over gisteren'), 'klacht');
  assert.equal(checkHandoff('Ik heb pijn na de behandeling'), 'medisch');
  assert.equal(checkHandoff('Wanneer zijn jullie open?'), null);
});

test('appointment intent', () => {
  assert.equal(isAppointmentIntent('Kan ik een afspraak maken?'), true);
  assert.equal(isAppointmentIntent('Waar kan ik parkeren?'), false);
});

test('parseDecision treats garbage as handoff', () => {
  assert.deepEqual(parseDecision('{"action":"answer","reply":"Hoi"}'), { action: 'answer', reply: 'Hoi' });
  assert.equal(parseDecision('geen json').action, 'handoff');
  assert.equal(parseDecision('{"action":"answer","reply":""}').action, 'handoff');
});

test('OnlineAfspraken signature matches the documented procedure', () => {
  const expected = createHash('sha256').update('id8methodgetResourceAPISECRETSALT').digest('hex');
  assert.equal(sign({ method: 'getResource', id: 8 }, 'APISECRET', 'SALT'), expected);
});

test('disabled account is ignored', async () => {
  writeAccounts({ enabled: false });
  const m = mocks();
  assert.equal(await handleEvent(event('Hallo'), m), 'disabled');
  assert.equal(m.calls.length, 0);
});

test('default mode drafts a private note, never a public reply', async () => {
  writeAccounts({});
  const m = mocks();
  assert.equal(await handleEvent(event('Waar is jullie salon?'), m), 'draft');
  assert.deepEqual(m.calls.map(c => c[0]), ['claude', 'note']);
  assert.equal(tokensUsed(1), 120);
});

test('auto mode replies publicly', async () => {
  writeAccounts({ mode: 'auto' });
  const m = mocks();
  assert.equal(await handleEvent(event('Waar is jullie salon?'), m), 'auto-reply');
  assert.equal(m.calls.at(-1)[0], 'reply');
});

test('sensitive message never reaches the AI', async () => {
  writeAccounts({ mode: 'auto' });
  const m = mocks();
  assert.equal(await handleEvent(event('Ik wil mijn geld terug, dit is een klacht'), m), 'handoff:klacht');
  assert.equal(m.calls.some(c => c[0] === 'claude'), false);
  assert.ok(m.calls.some(c => c[0] === 'handoff'), 'conversation is opened for a person');
});

test('appointment question sends the booking link without the AI', async () => {
  writeAccounts({});
  const m = mocks();
  assert.equal(await handleEvent(event('Ik wil graag een afspraak'), m), 'appointment');
  assert.match(m.calls[0][1], /onlineafspraken\.nl/);
  assert.equal(m.calls.some(c => c[0] === 'claude'), false);
});

test('monthly cap hands off', async () => {
  writeAccounts({ monthlyTokenCap: 10 });
  const m = mocks();
  assert.equal(await handleEvent(event('Waar is jullie salon?'), m), 'handoff:maandlimiet bereikt');
});

test('AI uncertainty hands off', async () => {
  writeAccounts({ monthlyTokenCap: 1000000 });
  const m = mocks({ action: 'handoff', reply: '' });
  assert.equal(await handleEvent(event('Iets raars'), m), 'handoff:onzeker');
});
