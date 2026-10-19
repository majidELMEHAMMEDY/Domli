import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'domli-set-'));
process.env.KNOWLEDGE_DIR = dir;
process.env.DATA_DIR = dir;
process.env.ACCOUNTS_FILE = join(dir, 'accounts.json');
process.env.ADMIN_TOKEN = 'admin-secret-token';
process.env.BOT_WEBHOOK_SECRET = 'hook-secret';
process.env.ANTHROPIC_API_KEY = 'env-key-0000000000000000000000';
writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Domli', enabled: true, chatwootBotToken: 'TOKEN-ABCDEFGH' } }));

const { createAppServer } = await import('../src/server.js');
const { effectiveSettings } = await import('../src/settings.js');
const { handleEvent } = await import('../src/handler.js');

const server = createAppServer({ onEvent: async () => {} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const auth = { Authorization: 'Bearer admin-secret-token', 'Content-Type': 'application/json' };
const call = (path, method = 'GET', body) => fetch(`${base}/admin/api${path}`, { method, headers: auth, body: body && JSON.stringify(body) });

test('settings start from the environment and never expose the key', async () => {
  const { settings } = await (await call('/settings')).json();
  assert.equal(settings.anthropicApiKeySet, true);
  assert.equal(settings.anthropicApiKeySource, 'environment');
  assert.equal(settings.anthropicApiKeyHint, '…0000');
  assert.equal(settings.webhookUrl, null);
  assert.ok(!JSON.stringify(settings).includes('env-key'));
});

test('saved key overrides the environment, is masked, stored with restricted permissions', async () => {
  const key = 'sk-ant-api03-SAVED-KEY-1234567890abcdef';
  const res = await call('/settings', 'PUT', { anthropicApiKey: key, model: 'claude-haiku-5-5', publicUrl: 'https://bot.example.nl/' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('SAVED-KEY'), 'response must not contain the key');
  const { settings } = JSON.parse(text);
  assert.equal(settings.anthropicApiKeySource, 'settings');
  assert.equal(settings.anthropicApiKeyHint, '…cdef');
  assert.equal(settings.webhookUrl, 'https://bot.example.nl/webhook/hook-secret');
  assert.equal(effectiveSettings().anthropicApiKey, key);
  assert.equal(statSync(join(dir, 'settings.json')).mode & 0o777, 0o600);
  const list = await (await call('/settings')).text();
  assert.ok(!list.includes('SAVED-KEY'));
});

test('empty key falls back to the environment; bad values are rejected', async () => {
  assert.equal((await call('/settings', 'PUT', { anthropicApiKey: 'has spaces and is bad' })).status, 400);
  assert.equal((await call('/settings', 'PUT', { model: 'bad model!' })).status, 400);
  assert.equal((await call('/settings', 'PUT', { publicUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call('/settings', 'PUT', { publicUrl: 'https://x.nl/?a=1' })).status, 400);
  assert.equal((await call('/settings', 'PUT', { anthropicApiKey: '' })).status, 200);
  assert.equal(effectiveSettings().anthropicApiKey, 'env-key-0000000000000000000000');
});

test('create a customer, update fields with validation, delete', async () => {
  assert.equal((await call('/accounts', 'POST', { id: '7', businessName: 'Salon Mila' })).status, 201);
  assert.equal((await call('/accounts', 'POST', { id: '7', businessName: 'Again' })).status, 400);
  assert.equal((await call('/accounts', 'POST', { id: 'abc', businessName: 'X' })).status, 400);
  assert.equal((await call('/accounts', 'POST', { id: '8', businessName: '  ' })).status, 400);
  const created = (await (await call('/accounts')).json()).accounts.find(a => a.id === '7');
  assert.deepEqual([created.enabled, created.mode, created.botTokenSet, created.tokensUsed], [false, 'draft', false, 0]);

  const patch = body => call('/accounts/7', 'PATCH', body);
  assert.equal((await patch({ monthlyTokenCap: 500 })).status, 400);
  assert.equal((await patch({ monthlyTokenCap: 'veel' })).status, 400);
  assert.equal((await patch({ monthlyTokenCap: 1500000, answerPrices: true, businessName: 'Salon Mila BV' })).status, 200);
  assert.equal((await patch({ chatwootBotToken: 'bad token' })).status, 400);
  assert.equal((await patch({ chatwootBotToken: 'GOOD-TOKEN-12345' })).status, 200);

  const after = (await (await call('/accounts')).json()).accounts.find(a => a.id === '7');
  assert.deepEqual([after.monthlyTokenCap, after.answerPrices, after.businessName, after.botTokenSet], [1500000, true, 'Salon Mila BV', true]);
  assert.ok(!JSON.stringify(after).includes('GOOD-TOKEN'));

  assert.equal((await call('/accounts/7', 'DELETE')).status, 200);
  assert.equal((await call('/accounts/7')).status, 404);
});

test('appointments: validation and write-only secrets', async () => {
  const patch = body => call('/accounts/1', 'PATCH', body);
  assert.equal((await patch({ appointments: { provider: 'link', bookingUrl: 'not a url' } })).status, 400);
  assert.equal((await patch({ appointments: { provider: 'magic', bookingUrl: 'https://x.nl' } })).status, 400);
  assert.equal((await patch({ appointments: { provider: 'onlineafspraken', bookingUrl: 'https://x.onlineafspraken.nl', appointmentTypeId: '12', apiKey: 'KEY-SECRET-VALUE', apiSecret: 'SECRET-SECRET-VALUE' } })).status, 200);
  // saving again with empty secret fields keeps the stored ones
  assert.equal((await patch({ appointments: { provider: 'onlineafspraken', bookingUrl: 'https://x.onlineafspraken.nl', appointmentTypeId: '13', apiKey: '', apiSecret: '' } })).status, 200);
  const stored = JSON.parse(readFileSync(process.env.ACCOUNTS_FILE, 'utf8'))['1'].appointments;
  assert.deepEqual([stored.apiKey, stored.apiSecret, stored.appointmentTypeId], ['KEY-SECRET-VALUE', 'SECRET-SECRET-VALUE', '13']);
  const text = await (await call('/accounts')).text();
  assert.ok(!text.includes('SECRET-VALUE') && !text.includes('KEY-SECRET'));
  assert.ok(text.includes('"apiKeySet":true'));
  assert.equal((await patch({ appointments: { provider: 'none' } })).status, 200);
  assert.equal(JSON.parse(readFileSync(process.env.ACCOUNTS_FILE, 'utf8'))['1'].appointments, undefined);
});

test('an AI failure hands the conversation to a person instead of leaving it waiting', async () => {
  const calls = [];
  const deps = {
    chatwoot: { sendReply: async () => calls.push('reply'), sendNote: async (...a) => calls.push(['note', a[3]]), handoffToHuman: async () => calls.push('handoff') },
    askClaude: async () => { throw new Error('401 invalid x-api-key'); },
  };
  const ev = { event: 'message_created', message_type: 'incoming', content: 'Waar zijn jullie gevestigd?', account: { id: 1 }, conversation: { id: 5 } };
  assert.equal(await handleEvent(ev, deps), 'handoff:technische fout');
  assert.ok(calls.includes('handoff'));
  assert.ok(!calls.includes('reply'));
});
