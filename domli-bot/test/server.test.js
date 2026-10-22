import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'domli-srv-'));
process.env.KNOWLEDGE_DIR = dir;
process.env.DATA_DIR = dir;
process.env.ACCOUNTS_FILE = join(dir, 'accounts.json');
process.env.ADMIN_TOKEN = 'admin-secret-token';
process.env.BOT_WEBHOOK_SECRET = 'hook-secret';
writeFileSync(
  process.env.ACCOUNTS_FILE,
  JSON.stringify({
    1: { businessName: 'Domli', enabled: true, mode: 'draft', chatwootBotToken: 'SECRET-BOT-TOKEN', answerPrices: true },
    2: { businessName: 'Salon', enabled: true, mode: 'draft', chatwootBotToken: 'x' },
  })
);

const { createAppServer } = await import('../src/server.js');
const { handleEvent } = await import('../src/handler.js');

const events = [];
const server = createAppServer({
  fetchPage: async url => ({ url, title: 'Geïmporteerd', text: 'Tekst van de pagina.' }),
  onEvent: async event => events.push(event),
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const auth = { Authorization: 'Bearer admin-secret-token', 'Content-Type': 'application/json' };
const call = (path, options = {}) => fetch(`${base}${path}`, options);

test('admin API requires the token', async () => {
  assert.equal((await call('/admin/api/accounts')).status, 401);
  assert.equal((await call('/admin/api/accounts', { headers: { Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('/admin/api/accounts', { headers: auth })).status, 200);
});

test('admin API never leaks bot tokens', async () => {
  const text = await (await call('/admin/api/accounts', { headers: auth })).text();
  assert.ok(!text.includes('SECRET-BOT-TOKEN'));
  assert.ok(text.includes('Domli'));
});

test('admin page and assets are served with a strict CSP', async () => {
  const res = await call('/admin');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await call('/admin/app.js')).status, 200);
});

test('add, import, list and delete knowledge', async () => {
  const add = await call('/admin/api/accounts/1/docs', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Prijzen', text: 'Start 25 euro.' }) });
  assert.equal(add.status, 201);
  const imp = await call('/admin/api/accounts/1/docs/url', { method: 'POST', headers: auth, body: JSON.stringify({ url: 'https://example.com/faq' }) });
  assert.equal(imp.status, 201);
  const list = await (await call('/admin/api/accounts/1/docs', { headers: auth })).json();
  assert.equal(list.docs.length, 2);
  assert.ok(!('text' in list.docs[0]));
  const id = (await add.json()).doc.id;
  assert.equal((await call(`/admin/api/accounts/1/docs/${id}`, { method: 'DELETE', headers: auth })).status, 200);
  assert.equal((await (await call('/admin/api/accounts/1/docs', { headers: auth })).json()).docs.length, 1);
});

test('bad input is rejected with 400, unknown account with 404', async () => {
  assert.equal((await call('/admin/api/accounts/1/docs', { method: 'POST', headers: auth, body: JSON.stringify({ title: '', text: '' }) })).status, 400);
  assert.equal((await call('/admin/api/accounts/1/docs/../../x', { method: 'DELETE', headers: auth })).status, 404);
  assert.equal((await call('/admin/api/accounts/99/docs', { headers: auth })).status, 404);
  assert.equal((await call('/admin/api/accounts/1', { method: 'PATCH', headers: auth, body: JSON.stringify({ mode: 'wild' }) })).status, 400);
});

test('account can be switched off from the admin and the bot respects it', async () => {
  assert.equal((await call('/admin/api/accounts/2', { method: 'PATCH', headers: auth, body: JSON.stringify({ enabled: false }) })).status, 200);
  assert.equal(JSON.parse(readFileSync(process.env.ACCOUNTS_FILE, 'utf8'))['2'].enabled, false);
  const ev = { event: 'message_created', message_type: 'incoming', content: 'Hallo', account: { id: 2 }, conversation: { id: 1 } };
  assert.equal(await handleEvent(ev, {}), 'disabled');
});

test('webhook only accepts the secret path', async () => {
  assert.equal((await call('/webhook/wrong', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await call('/webhook/hook-secret', { method: 'POST', body: JSON.stringify({ event: 'x' }) })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(events.length, 1);
});

test('price questions: handed off by default, answered for accounts with answerPrices', async () => {
  const calls = [];
  const deps = {
    chatwoot: { sendReply: async () => calls.push('reply'), sendNote: async (...a) => calls.push(['note', a[3]]), handoffToHuman: async () => calls.push('handoff') },
    askClaude: async () => { calls.push('claude'); return { decision: { action: 'answer', reply: 'Start kost 25 euro.' }, usage: { input: 10, output: 5 } }; },
  };
  const ev = id => ({ event: 'message_created', message_type: 'incoming', content: 'Wat kost het?', account: { id }, conversation: { id: 5 } });
  writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({
    1: { businessName: 'Domli', enabled: true, chatwootBotToken: 'x', answerPrices: true },
    3: { businessName: 'Salon', enabled: true, chatwootBotToken: 'x' },
  }));
  assert.equal(await handleEvent(ev(1), deps), 'draft');
  assert.ok(calls.includes('claude'));
  calls.length = 0;
  assert.equal(await handleEvent(ev(3), deps), 'handoff:prijs');
  assert.ok(!calls.includes('claude'));
});

test('complaints are never answered, even with answerPrices', async () => {
  writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Domli', enabled: true, chatwootBotToken: 'x', answerPrices: true } }));
  const deps = { chatwoot: { sendReply: async () => {}, sendNote: async () => {}, handoffToHuman: async () => {} }, askClaude: async () => { throw new Error('must not be called'); } };
  const ev = { event: 'message_created', message_type: 'incoming', content: 'Ik wil een klacht indienen', account: { id: 1 }, conversation: { id: 5 } };
  assert.equal(await handleEvent(ev, deps), 'handoff:klacht');
});

test('too many wrong tokens locks that client out, other clients are unaffected', async () => {
  const bad = ip => call('/admin/api/accounts', { headers: { Authorization: 'Bearer wrong', 'X-Real-IP': ip } });
  for (let i = 0; i < 10; i += 1) assert.equal((await bad('203.0.113.9')).status, 401);
  assert.equal((await bad('203.0.113.9')).status, 429);
  // even the right token is refused while locked
  assert.equal((await call('/admin/api/accounts', { headers: { ...auth, 'X-Real-IP': '203.0.113.9' } })).status, 429);
  assert.equal((await call('/admin/api/accounts', { headers: { ...auth, 'X-Real-IP': '203.0.113.10' } })).status, 200);
});

test('instructions can be saved from the admin, are listed, limited, and reach the AI prompt', async () => {
  writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Domli', enabled: true, chatwootBotToken: 'x' } }));
  const patch = body => call('/admin/api/accounts/1', { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
  assert.equal((await patch({ instructions: '  Je heet Mila. Wees kort.  ' })).status, 200);
  const list = await (await call('/admin/api/accounts', { headers: auth })).json();
  assert.equal(list.accounts[0].instructions, 'Je heet Mila. Wees kort.');
  assert.equal((await patch({ instructions: 'x'.repeat(2001) })).status, 400);

  const { buildSystemPrompt } = await import('../src/ai.js');
  const prompt = buildSystemPrompt({ businessName: 'Domli', instructions: 'Je heet Mila.', rules: [] }, 'kennis hier');
  assert.ok(prompt.includes('<instructies>\nJe heet Mila.\n</instructies>'));
  assert.ok(prompt.indexOf('Voor inhoudelijke vragen') < prompt.indexOf('<instructies>'), 'rules come before owner instructions');
  assert.ok(!buildSystemPrompt({ businessName: 'Domli', rules: [] }, 'k').includes('<instructies>'));

  let seen;
  const deps = {
    chatwoot: { sendReply: async () => {}, sendNote: async () => {}, handoffToHuman: async () => {} },
    askClaude: async args => { seen = args; return { decision: { action: 'answer', reply: 'Hoi' }, usage: { input: 1, output: 1 } }; },
  };
  const ev = { event: 'message_created', message_type: 'incoming', content: 'Waar zijn jullie gevestigd?', account: { id: 1 }, conversation: { id: 5 } };
  await handleEvent(ev, deps);
  assert.equal(seen.instructions, 'Je heet Mila. Wees kort.');
});
