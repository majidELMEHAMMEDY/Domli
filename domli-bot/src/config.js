import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const env = {
  port: Number(process.env.PORT || 3100),
  webhookSecret: process.env.BOT_WEBHOOK_SECRET || '',
  chatwootUrl: (process.env.CHATWOOT_URL || '').replace(/\/$/, ''),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  accountsFile: process.env.ACCOUNTS_FILE || './data/accounts.json',
  knowledgeDir: process.env.KNOWLEDGE_DIR || './knowledge',
  dataDir: process.env.DATA_DIR || './data',
};

// Read on every call so accounts can be switched off by editing the file, no restart needed.
export function getAccount(accountId) {
  if (!existsSync(env.accountsFile)) return null;
  const accounts = JSON.parse(readFileSync(env.accountsFile, 'utf8'));
  const account = accounts[String(accountId)];
  if (!account || account.enabled !== true) return null;
  return { mode: 'draft', monthlyTokenCap: 100000, ...account };
}

export function getKnowledge(accountId) {
  const file = join(env.knowledgeDir, `${accountId}.md`);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}
