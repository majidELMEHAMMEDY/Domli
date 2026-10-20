import { accessSync, constants, mkdirSync } from 'node:fs';
import { env } from './config.js';
import { createAppServer } from './server.js';

if (!env.webhookSecret) throw new Error('BOT_WEBHOOK_SECRET is required');

// The bot runs as user "node" (uid 1000): fail loudly at startup if the mounted folders are not writable.
for (const dir of [env.dataDir, env.knowledgeDir]) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch {
    console.error(`WAARSCHUWING: ${dir} is niet schrijfbaar. Voer uit op de server: chown -R 1000:1000 domli-bot/data domli-bot/knowledge`);
  }
}

createAppServer().listen(env.port, () => console.log(`domli-bot listening on :${env.port}`));
