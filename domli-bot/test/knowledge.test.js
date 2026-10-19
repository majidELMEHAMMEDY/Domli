import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'domli-kb-'));
process.env.KNOWLEDGE_DIR = dir;
process.env.DATA_DIR = dir;
process.env.ACCOUNTS_FILE = join(dir, 'accounts.json');

const { tokenize, chunkText, retrieve } = await import('../src/knowledge/chunk.js');
const { listDocs, addDoc, deleteDoc, LIMITS } = await import('../src/knowledge/store.js');
const { htmlToText, isPrivateAddress, fetchPage } = await import('../src/knowledge/fetchPage.js');

test('tokenize drops stop words and accents', () => {
  assert.deepEqual(tokenize('Wat zijn de Openingstijden van café?'), ['openingstijden', 'cafe']);
});

test('chunkText splits long text and keeps short paragraphs together', () => {
  assert.equal(chunkText('Eén.\n\nTwee.').length, 1);
  assert.ok(chunkText('a'.repeat(2000)).length >= 3);
});

test('small knowledge is sent whole', () => {
  const docs = [{ id: 'a', title: 'Tijden', text: 'Open van 9 tot 5.' }, { id: 'b', title: 'Parkeren', text: 'Gratis parkeren achter.' }];
  const out = retrieve(docs, 'iets heel anders');
  assert.deepEqual(out.sources.sort(), ['Parkeren', 'Tijden']);
});

test('large knowledge is filtered to the relevant chunks', () => {
  const filler = Array.from({ length: 40 }, (_, i) => `Alinea ${i} over onderwerpen die niets met de vraag te maken hebben ${'x'.repeat(150)}`).join('\n\n');
  const docs = [
    { id: 'a', title: 'Ruis', text: filler },
    { id: 'b', title: 'Parkeren', text: 'U kunt gratis parkeren achter het pand.' },
  ];
  const out = retrieve(docs, 'Waar kan ik parkeren?', { maxChars: 1000 });
  assert.ok(out.sources.includes('Parkeren'));
  assert.ok(out.text.length <= 1200);
});

test('store: add, list, delete, validation', () => {
  const doc = addDoc('7', { title: 'FAQ', text: 'Antwoord.' });
  assert.equal(listDocs('7').length, 1);
  assert.throws(() => addDoc('7', { title: '', text: 'x' }), /Titel/);
  assert.throws(() => addDoc('7', { title: 't', text: 'x'.repeat(LIMITS.maxChars + 1) }), /te lang/);
  assert.throws(() => addDoc('../etc', { title: 't', text: 'x' }), /Invalid account/);
  assert.throws(() => deleteDoc('7', '../../x'), /Invalid document/);
  deleteDoc('7', doc.id);
  assert.equal(listDocs('7').length, 0);
});

test('htmlToText removes scripts, nav and tags', () => {
  const { title, text } = htmlToText('<html><head><title>Mijn  salon</title><script>evil()</script></head><body><nav>Menu</nav><h1>Welkom</h1><p>Open &amp; gastvrij</p></body></html>');
  assert.equal(title, 'Mijn salon');
  assert.ok(text.includes('Welkom') && text.includes('Open & gastvrij'));
  assert.ok(!text.includes('evil') && !text.includes('Menu'));
});

test('private and internal addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('fetchPage refuses internal targets and bad schemes', async () => {
  await assert.rejects(fetchPage('http://127.0.0.1/'), /niet toegestaan/);
  await assert.rejects(fetchPage('http://localhost:1/'), /niet toegestaan/);
  await assert.rejects(fetchPage('http://169.254.169.254/latest/meta-data'), /niet toegestaan/);
  await assert.rejects(fetchPage('http://[::1]/'), /niet toegestaan/);
  await assert.rejects(fetchPage('file:///etc/passwd'), /http/);
  await assert.rejects(fetchPage('geen link'), /Ongeldige link/);
});

test('fetchPage reads a page, follows redirects and enforces limits (local server, private allowed only in test)', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') return void res.writeHead(302, { Location: '/page' }).end();
    if (req.url === '/big') return void res.writeHead(200, { 'Content-Type': 'text/html' }).end('x'.repeat(5000));
    if (req.url === '/json') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Test</title><p>Hallo wereld</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetchPage(`${base}/redirect`, { allowPrivate: true });
    assert.equal(page.title, 'Test');
    assert.ok(page.text.includes('Hallo wereld'));
    await assert.rejects(fetchPage(`${base}/big`, { allowPrivate: true, maxBytes: 1000 }), /te groot/);
    await assert.rejects(fetchPage(`${base}/json`, { allowPrivate: true }), /webpagina/);
  } finally {
    server.close();
  }
});
