import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './config.js';

// Global settings edited from the super admin. They override the environment variables, which stay as fallback.
// Secrets are write-only: the API only ever reports whether they are set and the last 4 characters.
const file = () => join(env.dataDir, 'settings.json');
const read = () => (existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {});

export function effectiveSettings() {
  const saved = read();
  return {
    anthropicApiKey: saved.anthropicApiKey || env.anthropicKey,
    model: saved.model || env.model,
    publicUrl: String(saved.publicUrl || env.publicUrl || '').replace(/\/$/, ''),
  };
}

export function saveSettings(patch) {
  const saved = read();
  if ('anthropicApiKey' in patch) {
    const key = String(patch.anthropicApiKey || '').trim();
    if (key && !/^[A-Za-z0-9_-]{20,300}$/.test(key)) throw new Error('Ongeldige API-sleutel');
    if (key) saved.anthropicApiKey = key;
    else delete saved.anthropicApiKey;
  }
  if ('model' in patch) {
    const model = String(patch.model || '').trim();
    if (model && !/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(model)) throw new Error('Ongeldige modelnaam');
    if (model) saved.model = model;
    else delete saved.model;
  }
  if ('publicUrl' in patch) {
    const raw = String(patch.publicUrl || '').trim();
    if (raw) {
      let url;
      try {
        url = new URL(raw);
      } catch {
        throw new Error('Ongeldige link');
      }
      if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash) throw new Error('Ongeldige link');
      saved.publicUrl = `${url.origin}${url.pathname}`.replace(/\/$/, '');
    } else {
      delete saved.publicUrl;
    }
  }
  mkdirSync(env.dataDir, { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(saved, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
}

export function publicSettings() {
  const saved = read();
  const effective = effectiveSettings();
  const key = effective.anthropicApiKey;
  return {
    anthropicApiKeySet: Boolean(key),
    anthropicApiKeyHint: key ? `…${key.slice(-4)}` : '',
    anthropicApiKeySource: saved.anthropicApiKey ? 'settings' : env.anthropicKey ? 'environment' : 'none',
    model: effective.model,
    publicUrl: effective.publicUrl,
    webhookUrl: effective.publicUrl && env.webhookSecret ? `${effective.publicUrl}/webhook/${env.webhookSecret}` : null,
  };
}
