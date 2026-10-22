import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveRules, effectiveBehaviour, normalizeRules, validateBehaviour, DEFAULTS } from './rules.js';

export const env = {
  port: Number(process.env.PORT || 3100),
  webhookSecret: process.env.BOT_WEBHOOK_SECRET || '',
  adminToken: process.env.ADMIN_TOKEN || '',
  chatwootUrl: (process.env.CHATWOOT_URL || '').replace(/\/$/, ''),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  publicUrl: process.env.BOT_PUBLIC_URL || '',
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
  return { mode: 'draft', monthlyTokenCap: DEFAULT_TOKEN_CAP, ...account, rules: effectiveRules(account), ...effectiveBehaviour(account) };
}

export const MAX_INSTRUCTIONS = 2000;
const DEFAULT_TOKEN_CAP = 2000000;

function readAccounts() {
  return existsSync(env.accountsFile) ? JSON.parse(readFileSync(env.accountsFile, 'utf8')) : {};
}

// Public view for the admin page: secrets are never included, only whether they are set.
export function listAccounts() {
  return Object.entries(readAccounts()).map(([id, a]) => {
    const rules = effectiveRules(a);
    const behaviour = effectiveBehaviour(a);
    return {
      id,
      businessName: a.businessName,
      enabled: a.enabled === true,
      mode: a.mode || 'draft',
      answerPrices: !rules.find(rule => rule.id === 'prices')?.enabled,
      instructions: a.instructions || '',
      handoffAgentId: a.handoffAgentId || null,
      monthlyTokenCap: a.monthlyTokenCap || DEFAULT_TOKEN_CAP,
      botTokenSet: Boolean(a.chatwootBotToken),
      rules,
      languages: behaviour.languages,
      unknownBehavior: behaviour.unknownBehavior,
      handoffMessage: behaviour.handoffMessage,
      promptTemplate: behaviour.promptTemplate,
      defaultPromptTemplate: DEFAULTS.promptTemplate,
      assistantName: behaviour.assistantName,
      model: behaviour.model,
      appointments: a.appointments
        ? {
            provider: a.appointments.provider || 'link',
            bookingUrl: a.appointments.bookingUrl || '',
            appointmentTypeId: a.appointments.appointmentTypeId || '',
            apiKeySet: Boolean(a.appointments.apiKey && a.appointments.apiSecret),
          }
        : { provider: 'none', bookingUrl: '', appointmentTypeId: '', apiKeySet: false },
    };
  });
}

function writeAccounts(accounts) {
  const tmp = `${env.accountsFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  renameSync(tmp, env.accountsFile);
}

export function createAccount(accountId, { businessName }) {
  if (!/^\d+$/.test(String(accountId))) throw new Error('Ongeldig account-id');
  const accounts = readAccounts();
  if (accounts[accountId]) throw new Error('Deze klant bestaat al');
  const name = String(businessName || '').trim().slice(0, 100);
  if (!name) throw new Error('Bedrijfsnaam is verplicht');
  accounts[accountId] = { businessName: name, enabled: false, mode: 'draft', monthlyTokenCap: DEFAULT_TOKEN_CAP };
  writeAccounts(accounts);
}

export function deleteAccount(accountId) {
  const accounts = readAccounts();
  delete accounts[String(accountId)];
  writeAccounts(accounts);
}

const isHttpUrl = value => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export function updateAccount(accountId, patch) {
  const accounts = readAccounts();
  const account = accounts[String(accountId)];
  if (!account) throw new Error('Onbekend account');

  if ('enabled' in patch) account.enabled = patch.enabled === true;
  Object.assign(account, validateBehaviour(patch));
  if ('rules' in patch) {
    account.rules = normalizeRules(patch.rules);
    delete account.answerPrices;
    delete account.handoffDemo;
  }
  // Old switch, still accepted: it edits the "prices" rule.
  if ('answerPrices' in patch) {
    account.rules = normalizeRules(effectiveRules(account));
    account.rules.find(rule => rule.id === 'prices').enabled = patch.answerPrices !== true;
    delete account.answerPrices;
  }
  if ('mode' in patch) {
    if (!['draft', 'auto'].includes(patch.mode)) throw new Error('Ongeldige modus');
    account.mode = patch.mode;
  }
  if ('businessName' in patch) {
    const name = String(patch.businessName || '').trim().slice(0, 100);
    if (!name) throw new Error('Bedrijfsnaam is verplicht');
    account.businessName = name;
  }
  if ('chatwootBotToken' in patch) {
    const token = String(patch.chatwootBotToken || '').trim();
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(token)) throw new Error('Ongeldig bot-token');
    account.chatwootBotToken = token;
  }
  if ('monthlyTokenCap' in patch) {
    const cap = Number(patch.monthlyTokenCap);
    if (!Number.isInteger(cap) || cap < 1000 || cap > 100_000_000) throw new Error('Maandlimiet moet tussen 1.000 en 100.000.000 tokens liggen');
    account.monthlyTokenCap = cap;
  }
  if ('instructions' in patch) {
    const text = String(patch.instructions || '').trim();
    if (text.length > MAX_INSTRUCTIONS) throw new Error(`Instructies zijn te lang (maximaal ${MAX_INSTRUCTIONS} tekens)`);
    account.instructions = text;
  }
  if ('handoffAgentId' in patch) {
    if (patch.handoffAgentId === null || patch.handoffAgentId === '' || patch.handoffAgentId === undefined) {
      delete account.handoffAgentId;
    } else {
      const agentId = Number(patch.handoffAgentId);
      if (!Number.isInteger(agentId) || agentId < 1) throw new Error('Ongeldige medewerker');
      account.handoffAgentId = agentId;
    }
  }
  if ('appointments' in patch) {
    const input = patch.appointments || {};
    if (input.provider === 'none') {
      delete account.appointments;
    } else if (['link', 'onlineafspraken'].includes(input.provider)) {
      if (!isHttpUrl(input.bookingUrl)) throw new Error('Vul een geldige boekingslink in (https://...)');
      const current = account.appointments || {};
      account.appointments = { provider: input.provider, bookingUrl: input.bookingUrl.trim() };
      if (input.provider === 'onlineafspraken') {
        account.appointments.appointmentTypeId = String(input.appointmentTypeId || current.appointmentTypeId || '').trim();
        // secrets are write-only: an empty field keeps the stored value
        account.appointments.apiKey = String(input.apiKey || '').trim() || current.apiKey || '';
        account.appointments.apiSecret = String(input.apiSecret || '').trim() || current.apiSecret || '';
      }
    } else {
      throw new Error('Onbekende afspraken-koppeling');
    }
  }
  writeAccounts(accounts);
}

// Used by the preset endpoints (presets.js imports this file, so the glue lives in the server).
export function mutateAccount(accountId, change) {
  const accounts = readAccounts();
  const account = accounts[String(accountId)];
  if (!account) throw new Error('Onbekend account');
  change(account);
  writeAccounts(accounts);
}

export function readAccount(accountId) {
  const account = readAccounts()[String(accountId)];
  if (!account) throw new Error('Onbekend account');
  return { ...account, rules: effectiveRules(account), ...effectiveBehaviour(account) };
}
