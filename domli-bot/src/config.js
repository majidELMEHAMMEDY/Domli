import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const env = {
  port: Number(process.env.PORT || 3100),
  webhookSecret: process.env.BOT_WEBHOOK_SECRET || '',
  adminToken: process.env.ADMIN_TOKEN || '',
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
  return { mode: 'draft', monthlyTokenCap: 2000000, ...account };
}

function readAccounts() {
  return existsSync(env.accountsFile) ? JSON.parse(readFileSync(env.accountsFile, 'utf8')) : {};
}

// Public view for the admin page: never includes tokens or API keys.
export function listAccounts() {
  return Object.entries(readAccounts()).map(([id, a]) => ({
    id,
    businessName: a.businessName,
    enabled: a.enabled === true,
    mode: a.mode || 'draft',
    answerPrices: a.answerPrices === true,
  }));
}

export function updateAccount(accountId, patch) {
  const accounts = readAccounts();
  const account = accounts[String(accountId)];
  if (!account) throw new Error('Onbekend account');
  if ('enabled' in patch) account.enabled = patch.enabled === true;
  if ('mode' in patch) {
    if (!['draft', 'auto'].includes(patch.mode)) throw new Error('Ongeldige modus');
    account.mode = patch.mode;
  }
  const tmp = `${env.accountsFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(accounts, null, 2));
  renameSync(tmp, env.accountsFile);
}
