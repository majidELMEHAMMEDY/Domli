import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'domli-rules-'));
process.env.KNOWLEDGE_DIR = dir;
process.env.DATA_DIR = dir;
process.env.ACCOUNTS_FILE = join(dir, 'accounts.json');
process.env.ADMIN_TOKEN = 'admin-secret-token';
process.env.BOT_WEBHOOK_SECRET = 'hook-secret';
process.env.ANTHROPIC_API_KEY = 'k'.repeat(30);
writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Domli', enabled: true, chatwootBotToken: 'TOKEN-ABCDEFGH' } }));

const { DEFAULTS, ruleMatches, firstMatch, normalizeRules, effectiveRules, validateBehaviour, renderMessage } = await import('../src/rules.js');
const { buildSystemPrompt } = await import('../src/ai.js');
const { handleEvent } = await import('../src/handler.js');
const { createAppServer } = await import('../src/server.js');

const server = createAppServer({ onEvent: async () => {} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const auth = { Authorization: 'Bearer admin-secret-token', 'Content-Type': 'application/json' };
const api = (path, method = 'GET', body) => fetch(`${base}/admin/api${path}`, { method, headers: auth, body: body && JSON.stringify(body) });
const account = async () => (await (await api('/accounts')).json()).accounts[0];
const rule = (id, rules) => rules.find(r => r.id === id);

test('triggers: whole words, trailing * for prefixes, accents and case ignored, word limit', () => {
  const r = { enabled: true, triggers: ['klacht*', 'cafe', 'sign up'], maxWords: 5 };
  assert.equal(ruleMatches(r, 'Ik heb een KLACHTEN'), true);
  assert.equal(ruleMatches(r, 'een café aan de hoek'), true);
  assert.equal(ruleMatches(r, 'I want to sign up'), true);
  assert.equal(ruleMatches(r, 'cafeine is leuk'), false, 'whole words only');
  assert.equal(ruleMatches(r, 'ik heb een klacht over de service van gisteren en vandaag'), false, 'too many words');
  assert.equal(ruleMatches({ ...r, enabled: false }, 'klacht'), false);
  assert.equal(ruleMatches({ enabled: true, triggers: [], maxWords: 0 }, 'klacht'), false);
});

test('normalizeRules: validation, ids, limits', () => {
  assert.throws(() => normalizeRules('x'), /lijst/);
  assert.throws(() => normalizeRules([{ type: 'nope', name: 'x', triggers: [] }]), /Ongeldig type/);
  assert.throws(() => normalizeRules([{ type: 'reply', name: '', triggers: [] }]), /naam/);
  assert.throws(() => normalizeRules([{ type: 'reply', name: 'x', triggers: ['a'.repeat(81)] }]), /te lang/);
  assert.throws(() => normalizeRules([{ type: 'reply', name: 'x', triggers: [], maxWords: 99 }]), /tussen 0 en 50/);
  assert.throws(() => normalizeRules([{ type: 'reply', name: 'x', triggers: [], message: { nl: 'a'.repeat(1001) } }]), /te lang/);
  const rules = normalizeRules([{ type: 'reply', name: 'Opening hours', enabled: true, triggers: 'open\nopeningstijden', message: { nl: 'Ma-vr 9-17', en: 'Mon-Fri 9-5' } }]);
  const custom = rules.find(r => r.name === 'Opening hours');
  assert.match(custom.id, /^opening-hours-/);
  assert.deepEqual(custom.triggers, ['open', 'openingstijden']);
  const dup = normalizeRules([{ id: 'same', type: 'reply', name: 'a', triggers: [] }, { id: 'same', type: 'reply', name: 'b', triggers: [] }]);
  assert.equal(new Set(dup.map(r => r.id)).size, dup.length);
});

test('locked rules (complaints, health) can be edited but never disabled or removed', () => {
  const out = normalizeRules([{ id: 'complaints', type: 'handoff', name: 'Klachten', enabled: false, triggers: ['gezeur'] }]);
  const complaints = rule('complaints', out);
  assert.equal(complaints.enabled, true);
  assert.equal(complaints.locked, true);
  assert.deepEqual(complaints.triggers, ['gezeur'], 'trigger edit is kept');
  assert.ok(rule('medical', out), 'a removed locked rule comes back');
  assert.equal(rule('medical', out).enabled, true);
});

test('effectiveRules: defaults, and the two old switches as starting point', () => {
  assert.equal(rule('prices', effectiveRules({})).enabled, true);
  assert.equal(rule('demo', effectiveRules({})).enabled, false);
  assert.equal(rule('prices', effectiveRules({ answerPrices: true })).enabled, false);
  assert.equal(rule('demo', effectiveRules({ handoffDemo: true })).enabled, true);
  const own = [{ id: 'prices', type: 'handoff', name: 'P', enabled: true, triggers: ['x'] }];
  assert.equal(rule('prices', effectiveRules({ rules: own })).triggers[0], 'x');
});

test('validateBehaviour', () => {
  assert.deepEqual(validateBehaviour({ languages: ['nl'] }), { languages: ['nl'] });
  assert.throws(() => validateBehaviour({ languages: [] }), /minstens één taal/);
  assert.throws(() => validateBehaviour({ languages: ['xx'] }), /minstens één taal/);
  assert.throws(() => validateBehaviour({ unknownBehavior: 'explode' }), /onbekende vragen/);
  assert.throws(() => validateBehaviour({ model: 'bad model!' }), /modelnaam/);
  assert.throws(() => validateBehaviour({ assistantName: 'x'.repeat(41) }), /te lang/);
  assert.equal(validateBehaviour({ promptTemplate: DEFAULTS.promptTemplate }).promptTemplate, '', 'the default text is not stored as an override');
  assert.equal(validateBehaviour({ handoffMessage: { nl: 'Even geduld', en: 'One moment' } }).handoffMessage.en, 'One moment');
});

test('renderMessage fills placeholders', () => {
  assert.equal(renderMessage('Boek via {{booking_url}} bij {{business}}', { bookingUrl: 'https://x.nl', business: 'Salon' }), 'Boek via https://x.nl bij Salon');
  assert.equal(renderMessage('Hallo {{booking_url}}'), 'Hallo');
});

test('prompt is built from the customer settings: languages, unknown behaviour, name, handoff topics, notes', () => {
  const rules = effectiveRules({});
  const base = { businessName: 'Salon Mila', rules };
  let p = buildSystemPrompt(base, 'kennis');
  assert.match(p, /klantenservice-assistent van Salon Mila/);
  assert.match(p, /Nederlands of Engels/);
  assert.match(p, /Kies "handoff" ook als het gaat om: een klacht; gezondheid of medische zaken; offertes op maat, kortingen, facturen, terugbetalingen of betalingsproblemen/);
  assert.match(p, /kies dan "handoff"/);
  p = buildSystemPrompt({ ...base, languages: ['nl'], assistantName: 'Mila', unknownBehavior: 'say_unknown' }, 'k');
  assert.match(p, /Je heet Mila\./);
  assert.match(p, /altijd in het Nederlands/);
  assert.match(p, /niet "handoff"/);
  assert.ok(!/Nederlands of Engels/.test(p));
  p = buildSystemPrompt({ ...base, languages: ['en'] }, 'k');
  assert.match(p, /Always answer in English/);
  // prices rule off: its note replaces the topic
  const open = effectiveRules({ answerPrices: true });
  p = buildSystemPrompt({ ...base, rules: open }, 'k');
  assert.ok(!/offertes op maat, kortingen, facturen, terugbetalingen of betalingsproblemen\./.test(p));
  assert.match(p, /prijzen en pakketten noemen die in de kennis staan/);
  // a custom template with placeholders; unknown placeholders stay visible
  p = buildSystemPrompt({ ...base, promptTemplate: 'Hallo {{business}}. {{language_rule}} {{onbekend}}' }, 'k');
  assert.match(p, /^Hallo Salon Mila\./);
  assert.match(p, /\{\{onbekend\}\}/);
  // the technical contract is always there
  assert.match(p, /Antwoord ALLEEN met JSON/);
  assert.match(p, /<kennis>\nk\n<\/kennis>/);
});

test('API: rules round-trip, validation errors, locked rules enforced', async () => {
  let a = await account();
  assert.equal(a.rules.length, DEFAULTS.rules.length);
  assert.ok(a.defaultPromptTemplate.includes('{{business}}'));
  const edited = a.rules.map(r => (r.id === 'prices' ? { ...r, enabled: false, triggers: ['tarief'] } : r));
  edited.push({ type: 'handoff', name: 'Spoed', enabled: true, triggers: ['spoed', 'urgent'], message: { nl: 'Spoed: we bellen u terug.', en: 'Urgent: we will call you back.' } });
  assert.equal((await api('/accounts/1', 'PATCH', { rules: edited })).status, 200);
  a = await account();
  assert.equal(rule('prices', a.rules).enabled, false);
  assert.equal(a.answerPrices, true, 'derived from the prices rule');
  assert.equal(a.rules.find(r => r.name === 'Spoed').message.nl, 'Spoed: we bellen u terug.');
  // bad input is refused and changes nothing
  assert.equal((await api('/accounts/1', 'PATCH', { rules: [{ type: 'bogus', name: 'x' }] })).status, 400);
  assert.equal((await account()).rules.length, a.rules.length);
  // trying to switch off a locked rule through the API does not work
  const tampered = a.rules.map(r => (r.id === 'medical' ? { ...r, enabled: false } : r));
  assert.equal((await api('/accounts/1', 'PATCH', { rules: tampered })).status, 200);
  assert.equal(rule('medical', (await account()).rules).enabled, true);
});

test('API: behaviour fields', async () => {
  assert.equal((await api('/accounts/1', 'PATCH', { languages: ['en'], unknownBehavior: 'say_unknown', assistantName: 'Mila', model: 'claude-sonnet-5-5', handoffMessage: { nl: 'Zo meteen.', en: 'Shortly.' } })).status, 200);
  const a = await account();
  assert.deepEqual([a.languages, a.unknownBehavior, a.assistantName, a.model, a.handoffMessage.en], [['en'], 'say_unknown', 'Mila', 'claude-sonnet-5-5', 'Shortly.']);
  assert.equal((await api('/accounts/1', 'PATCH', { languages: ['fr'] })).status, 400);
  assert.equal((await api('/accounts/1', 'PATCH', { promptTemplate: 'x'.repeat(6001) })).status, 400);
  // template equal to the default is stored as "use default"
  await api('/accounts/1', 'PATCH', { promptTemplate: DEFAULTS.promptTemplate });
  assert.equal(JSON.parse(readFileSync(process.env.ACCOUNTS_FILE, 'utf8'))['1'].promptTemplate, '');
  await api('/accounts/1', 'PATCH', { languages: ['nl', 'en'], unknownBehavior: 'handoff', assistantName: '', model: '' });
});

test('handler uses the customer rules: custom hand-over rule, custom quick reply, disabled rules ignored, language limits', async () => {
  const deps = () => {
    const calls = [];
    return { calls, chatwoot: { handoffToHuman: async () => calls.push('open'), assignAgent: async () => calls.push('assign'), sendReply: async (...a) => calls.push(`reply:${a[3]}`), sendNote: async (...a) => calls.push(`note:${a[3]}`) }, askClaude: async () => { calls.push('claude'); return { decision: { action: 'answer', reply: 'AI' }, usage: { input: 1, output: 1 } }; } };
  };
  const ev = text => ({ event: 'message_created', message_type: 'incoming', content: text, account: { id: 1 }, conversation: { id: 3 } });
  const rules = normalizeRules([
    ...DEFAULTS.rules.filter(r => r.locked),
    { id: 'urgent', type: 'handoff', name: 'Urgent', enabled: true, reason: 'spoed', triggers: ['spoed'], message: { nl: 'Spoed! We bellen u terug.', en: 'Urgent! We will call you back.' } },
    { id: 'hours', type: 'reply', name: 'Hours', enabled: true, triggers: ['openingstijden', 'opening hours'], message: { nl: 'Ma-vr 9-17 bij {{business}}.', en: 'Mon-Fri 9-5 at {{business}}.' } },
    { id: 'off', type: 'reply', name: 'Off', enabled: false, triggers: ['uitgeschakeld'], message: { nl: 'X', en: 'X' } },
  ]);
  writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Salon', enabled: true, mode: 'auto', chatwootBotToken: 'TOKEN-ABCDEFGH', rules, languages: ['nl'] } }));
  let d = deps();
  assert.equal(await handleEvent(ev('Dit is spoed!'), d), 'handoff:spoed');
  assert.ok(d.calls.includes('reply:Spoed! We bellen u terug.'));
  d = deps();
  assert.equal(await handleEvent(ev('wat zijn de openingstijden'), d), 'quick-reply');
  assert.deepEqual(d.calls, ['reply:Ma-vr 9-17 bij Salon.']);
  d = deps();
  assert.equal(await handleEvent(ev('opening hours?'), d), 'quick-reply');
  assert.match(d.calls[0], /Ma-vr/, 'English visitor gets Dutch because only Dutch is allowed for this customer');
  d = deps();
  assert.equal(await handleEvent(ev('uitgeschakeld'), d), 'auto-reply', 'a disabled rule does nothing');
  assert.ok(d.calls.includes('claude'));
  // no price rule in this customer's list: price questions go to the AI
  d = deps();
  assert.equal(await handleEvent(ev('Wat kost een knipbeurt?'), d), 'auto-reply');
});

test('presets: built-in list, apply to a customer, save and delete a custom one', async () => {
  writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Domli', enabled: true, chatwootBotToken: 'TOKEN-ABCDEFGH' } }));
  const list = (await (await api('/presets')).json()).presets;
  assert.deepEqual(list.filter(p => p.builtin).map(p => p.name).sort(), ['local-business', 'sales', 'support']);
  assert.equal((await api('/accounts/1/preset', 'POST', { name: 'nope' })).status, 400);
  assert.equal((await api('/accounts/1/preset', 'POST', { name: 'sales' })).status, 200);
  let a = await account();
  assert.equal(rule('prices', a.rules).enabled, false);
  assert.equal(rule('demo', a.rules).enabled, true);
  assert.equal(a.unknownBehavior, 'say_unknown');
  assert.match(a.instructions, /verkoopassistent/);
  assert.equal(rule('medical', a.rules).enabled, true, 'locked rules survive any preset');
  // customise, save as preset, switch to another preset, apply the saved one again
  const custom = a.rules.map(r => (r.id === 'demo' ? { ...r, triggers: ['proefles'] } : r));
  await api('/accounts/1', 'PATCH', { rules: custom, instructions: 'Eigen instructies' });
  assert.equal((await api('/presets', 'POST', { name: 'sales', accountId: '1' })).status, 400, 'built-in names are reserved');
  assert.equal((await api('/presets', 'POST', { name: 'Kapper!', accountId: '1' })).status, 400, 'bad characters');
  assert.equal((await api('/presets', 'POST', { name: 'Kapper', description: 'Voor kappers', accountId: '1' })).status, 201);
  await api('/accounts/1/preset', 'POST', { name: 'local-business' });
  a = await account();
  assert.equal(rule('demo', a.rules).enabled, false);
  assert.equal((await api('/accounts/1/preset', 'POST', { name: 'Kapper' })).status, 200);
  a = await account();
  assert.deepEqual(rule('demo', a.rules).triggers, ['proefles']);
  assert.equal(a.instructions, 'Eigen instructies');
  assert.ok(existsSync(join(dir, 'presets.json')));
  assert.equal((await api('/presets/sales', 'DELETE')).status, 400);
  assert.equal((await api('/presets/Kapper', 'DELETE')).status, 200);
  assert.ok(!(await (await api('/presets')).json()).presets.some(p => p.name === 'Kapper'));
});

test('stored rules that still carry the old built-in price hint are upgraded, custom hints are left alone', () => {
  const stored = hint => effectiveRules({ rules: [{ id: 'prices', type: 'handoff', name: 'P', enabled: true, triggers: ['x'], promptHint: hint }] }).find(r => r.id === 'prices').promptHint;
  assert.equal(stored('prijzen, offertes, facturen of betalingen'), DEFAULTS.rules.find(r => r.id === 'prices').promptHint);
  assert.equal(stored('mijn eigen tekst'), 'mijn eigen tekst');
});

test('Test tab API: shows the decision and the matching rule without sending anything or counting usage', async () => {
  writeFileSync(process.env.ACCOUNTS_FILE, JSON.stringify({ 1: { businessName: 'Domli', enabled: false, chatwootBotToken: 'TOKEN-ABCDEFGH' } }));
  const { tokensUsed } = await import('../src/usage.js');
  const usageBefore = tokensUsed(1);
  const test = async message => (await api('/accounts/1/test', 'POST', { message })).json();
  let { result } = await test('Ik heb een klacht over mijn bestelling');
  assert.deepEqual([result.type, result.rule, result.reason, result.language], ['handoff', 'Complaints', 'klacht', 'nl']);
  ({ result } = await test('hey'));
  assert.deepEqual([result.type, result.rule], ['quick-reply', 'Greeting']);
  assert.match(result.reply, /Hello/);
  ({ result } = await test('what are your prices'));
  assert.equal(result.rule, 'Prices and payments');
  assert.equal((await api('/accounts/1/test', 'POST', { message: '   ' })).status, 400);
  assert.equal((await api('/accounts/99/test', 'POST', { message: 'hi' })).status, 404);

  // a question that reaches the AI (stubbed): decision, raw answer, sources and the exact prompt are returned
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const original = Anthropic.Messages.prototype.create;
  Anthropic.Messages.prototype.create = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"action":"answer","reply":"Start kost 25 euro."}' }], usage: { input_tokens: 10, output_tokens: 5 } });
  try {
    await api('/accounts/1/docs', 'POST', { title: 'Prijzen', text: 'Start kost 25 euro per maand.' });
    await api('/accounts/1', 'PATCH', { rules: DEFAULTS.rules.map(r => (r.id === 'prices' ? { ...r, enabled: false } : r)) });
    ({ result } = await test('Vertel me over de pakketten'));
    assert.equal(result.type, 'ai');
    assert.equal(result.decision.action, 'answer');
    assert.equal(result.raw, '{"action":"answer","reply":"Start kost 25 euro."}');
    assert.deepEqual(result.knowledge, ['Prijzen']);
    assert.match(result.prompt, /<kennis>[\s\S]*Start kost 25 euro/);
    assert.match(result.prompt, /prijzen en pakketten noemen die in de kennis staan/);
  } finally {
    Anthropic.Messages.prototype.create = original;
  }
  assert.equal(tokensUsed(1), usageBefore, 'dry runs are not counted as usage');
});
