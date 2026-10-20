import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { env, listAccounts, updateAccount, createAccount, deleteAccount } from './config.js';
import { publicSettings, saveSettings } from './settings.js';
import { tokensUsed } from './usage.js';
import { handleEvent } from './handler.js';
import { listDocs, addDoc, deleteDoc } from './knowledge/store.js';
import { fetchPage as defaultFetchPage } from './knowledge/fetchPage.js';

const adminDir = join(dirname(fileURLToPath(import.meta.url)), 'admin');
const STATIC = {
  '/admin': ['index.html', 'text/html; charset=utf-8'],
  '/admin/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin/app.css': ['app.css', 'text/css; charset=utf-8'],
};
const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Bericht te groot'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

// Brute-force guard: 10 wrong tokens per client per 10 minutes. Behind nginx the real client is in X-Real-IP
// (only nginx can reach this port), otherwise the socket address.
const failures = new Map();
const MAX_FAILURES = 10;
const WINDOW_MS = 10 * 60 * 1000;

function clientKey(req) {
  return String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown');
}

function tooManyFailures(key) {
  const recent = (failures.get(key) || []).filter(t => t > Date.now() - WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

async function adminApi(req, res, pathname, deps) {
  const key = clientKey(req);
  if (tooManyFailures(key)) return json(res, 429, { error: 'Te veel pogingen, probeer het later opnieuw' });
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!env.adminToken || !safeEqual(token, env.adminToken)) {
    failures.set(key, [...(failures.get(key) || []), Date.now()]);
    return json(res, 401, { error: 'Niet ingelogd' });
  }

  const parts = pathname.split('/').filter(Boolean); // admin, api, accounts, :id, docs, ...
  try {
    if (parts[2] === 'settings' && parts.length === 3) {
      if (req.method === 'PUT') saveSettings(JSON.parse((await readBody(req)) || '{}'));
      else if (req.method !== 'GET') return json(res, 405, { error: 'Niet toegestaan' });
      return json(res, 200, { settings: publicSettings() });
    }
    if (parts[2] !== 'accounts') return json(res, 404, { error: 'Niet gevonden' });

    const withUsage = account => ({ ...account, tokensUsed: tokensUsed(account.id) });
    if (parts.length === 3 && req.method === 'GET') return json(res, 200, { accounts: listAccounts().map(withUsage) });
    if (parts.length === 3 && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      createAccount(String(body.id || ''), { businessName: body.businessName });
      return json(res, 201, { ok: true });
    }

    const accountId = parts[3];
    if (!listAccounts().some(a => a.id === accountId)) return json(res, 404, { error: 'Onbekend account' });

    if (parts.length === 4 && req.method === 'PATCH') {
      updateAccount(accountId, JSON.parse((await readBody(req)) || '{}'));
      return json(res, 200, { ok: true });
    }
    if (parts.length === 4 && req.method === 'DELETE') {
      deleteAccount(accountId);
      return json(res, 200, { ok: true });
    }
    if (parts[4] !== 'docs') return json(res, 404, { error: 'Niet gevonden' });

    if (parts.length === 5 && req.method === 'GET') {
      const docs = listDocs(accountId).map(({ text, ...doc }) => ({ ...doc, chars: text.length }));
      return json(res, 200, { docs });
    }
    if (parts.length === 5 && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return json(res, 201, { doc: addDoc(accountId, { title: body.title, text: body.text }) });
    }
    if (parts.length === 6 && parts[5] === 'url' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const page = await deps.fetchPage(String(body.url || ''));
      return json(res, 201, { doc: addDoc(accountId, { title: body.title || page.title, text: page.text, url: page.url }) });
    }
    if (parts.length === 6 && req.method === 'DELETE') {
      deleteDoc(accountId, parts[5]);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Niet gevonden' });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

export function createAppServer({ fetchPage = defaultFetchPage, onEvent = handleEvent } = {}) {
  const webhookPath = Buffer.from(`/webhook/${env.webhookSecret}`);

  return createServer(async (req, res) => {
    const pathname = (req.url || '').split('?')[0];

    if (req.method === 'GET' && pathname === '/health') return void res.writeHead(200).end('ok');

    if (env.adminToken && req.method === 'GET' && STATIC[pathname]) {
      const [file, type] = STATIC[pathname];
      res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': ADMIN_CSP, 'Cache-Control': 'no-store' });
      return void res.end(readFileSync(join(adminDir, file)));
    }
    if (env.adminToken && pathname.startsWith('/admin/api/')) return adminApi(req, res, pathname, { fetchPage });

    const given = Buffer.from(pathname);
    if (req.method !== 'POST' || given.length !== webhookPath.length || !timingSafeEqual(given, webhookPath)) {
      return void res.writeHead(404).end();
    }
    try {
      const body = await readBody(req);
      res.writeHead(200).end('ok'); // answer Chatwoot immediately, work in the background
      const event = JSON.parse(body);
      onEvent(event)
        .then(outcome => {
          // Log what happened, never the message text. 'ignored' covers the many Chatwoot events that are not customer messages.
          if (outcome !== 'ignored') console.log(`handled account=${event.account?.id} conversation=${event.conversation?.id} -> ${outcome}`);
        })
        .catch(error => console.error('handler error:', error.message));
    } catch (error) {
      console.error('bad payload:', error.message);
    }
  });
}
