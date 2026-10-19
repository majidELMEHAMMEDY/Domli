import { env } from './config.js';
import { createAppServer } from './server.js';

if (!env.webhookSecret) throw new Error('BOT_WEBHOOK_SECRET is required');

createAppServer().listen(env.port, () => console.log(`domli-bot listening on :${env.port}`));
