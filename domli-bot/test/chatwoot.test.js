import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let received;
let mode = 'ok';
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    received = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') };
    if (mode === 'redirect') return void res.writeHead(301, { Location: 'https://rails:3000/x' }).end();
    if (mode === 'unauthorized') return void res.writeHead(401).end();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.CHATWOOT_URL = `http://127.0.0.1:${server.address().port}`;
const { sendReply, sendNote, handoffToHuman } = await import('../src/chatwoot.js');
test.after(() => server.close());

test('requests tell Domli they are secure, carry the token, and use the right path and body', async () => {
  mode = 'ok';
  await sendNote(2, 9, 'BOT-TOKEN-123', 'concept');
  assert.equal(received.url, '/api/v1/accounts/2/conversations/9/messages');
  assert.equal(received.headers['x-forwarded-proto'], 'https');
  assert.equal(received.headers.api_access_token, 'BOT-TOKEN-123');
  assert.deepEqual(received.body, { content: 'concept', message_type: 'outgoing', private: true });
  await sendReply(2, 9, 't', 'hoi');
  assert.equal(received.body.private, false);
  await handoffToHuman(2, 9, 't');
  assert.equal(received.url, '/api/v1/accounts/2/conversations/9/toggle_status');
});

test('a redirect is reported clearly instead of "fetch failed"', async () => {
  mode = 'redirect';
  await assert.rejects(sendNote(2, 9, 't', 'x'), /stuurde door naar https:\/\/rails:3000\/x/);
});

test('API errors name the status', async () => {
  mode = 'unauthorized';
  await assert.rejects(sendNote(2, 9, 't', 'x'), /Chatwoot API 401/);
});
