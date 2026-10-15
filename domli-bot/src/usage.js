import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './config.js';

const usageFile = () => join(env.dataDir, 'usage.json');
const currentMonth = () => new Date().toISOString().slice(0, 7);

function load() {
  return existsSync(usageFile()) ? JSON.parse(readFileSync(usageFile(), 'utf8')) : {};
}

export function tokensUsed(accountId) {
  return load()[`${accountId}:${currentMonth()}`] || 0;
}

export function isOverCap(accountId, cap) {
  return tokensUsed(accountId) >= cap;
}

// Logs token counts only. Message content is never written to disk.
export function recordUsage(accountId, inputTokens, outputTokens) {
  mkdirSync(env.dataDir, { recursive: true });
  const usage = load();
  const key = `${accountId}:${currentMonth()}`;
  usage[key] = (usage[key] || 0) + inputTokens + outputTokens;
  const tmp = `${usageFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(usage, null, 2));
  renameSync(tmp, usageFile());
  appendFileSync(
    join(env.dataDir, 'tokens.log'),
    `${JSON.stringify({ ts: new Date().toISOString(), account: accountId, in: inputTokens, out: outputTokens })}\n`
  );
}
