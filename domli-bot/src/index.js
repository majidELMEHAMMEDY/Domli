import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { env } from './config.js';
import { handleEvent } from './handler.js';

if (!env.webhookSecret) throw new Error('BOT_WEBHOOK_SECRET is required');

const expected = Buffer.from(`/webhook/${env.webhookSecret}`);

function authorised(url) {
  const given = Buffer.from(url.split('?')[0]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.method !== 'POST' || !authorised(req.url)) {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    // Answer Chatwoot immediately, work in the background.
    res.writeHead(200).end('ok');
    try {
      const event = JSON.parse(Buffer.concat(chunks).toString());
      handleEvent(event).catch(error => console.error('handler error:', error.message));
    } catch (error) {
      console.error('bad payload:', error.message);
    }
  });
});

server.listen(env.port, () => console.log(`domli-bot listening on :${env.port}`));
