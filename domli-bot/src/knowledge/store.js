import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '../config.js';

export const LIMITS = { maxDocs: 200, maxChars: 100000, maxTitle: 120 };

function accountDir(accountId) {
  if (!/^\d+$/.test(String(accountId))) throw new Error('Invalid account id');
  return join(env.knowledgeDir, String(accountId));
}

const docFile = (accountId, docId) => {
  if (!/^[a-f0-9]{16}$/.test(docId)) throw new Error('Invalid document id');
  return join(accountDir(accountId), `${docId}.json`);
};

export function listDocs(accountId) {
  const dir = accountDir(accountId);
  const docs = existsSync(dir)
    ? readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')))
    : [];
  // Legacy single file <accountId>.md still works as one document.
  const legacy = join(env.knowledgeDir, `${accountId}.md`);
  if (existsSync(legacy)) {
    docs.push({ id: 'legacy', title: 'Kennisbestand', source: 'file', text: readFileSync(legacy, 'utf8'), addedAt: null });
  }
  return docs.sort((a, z) => String(z.addedAt).localeCompare(String(a.addedAt)));
}

export function addDoc(accountId, { title, text, url = null }) {
  const cleanTitle = String(title || '').trim().slice(0, LIMITS.maxTitle);
  const cleanText = String(text || '').trim();
  if (!cleanTitle) throw new Error('Titel is verplicht');
  if (!cleanText) throw new Error('Tekst is leeg');
  if (cleanText.length > LIMITS.maxChars) throw new Error(`Tekst is te lang (maximaal ${LIMITS.maxChars} tekens)`);
  const dir = accountDir(accountId);
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).filter(n => n.endsWith('.json')).length >= LIMITS.maxDocs) throw new Error('Maximaal aantal documenten bereikt');

  const doc = {
    id: randomBytes(8).toString('hex'),
    title: cleanTitle,
    source: url ? 'url' : 'text',
    url,
    text: cleanText,
    addedAt: new Date().toISOString(),
  };
  const file = docFile(accountId, doc.id);
  writeFileSync(`${file}.tmp`, JSON.stringify(doc));
  renameSync(`${file}.tmp`, file);
  return doc;
}

export function deleteDoc(accountId, docId) {
  if (docId === 'legacy') {
    rmSync(join(env.knowledgeDir, `${accountId}.md`), { force: true });
    return;
  }
  rmSync(docFile(accountId, docId), { force: true });
}
