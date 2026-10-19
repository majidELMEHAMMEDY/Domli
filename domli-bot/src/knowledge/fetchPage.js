import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

// Imports a public web page as text. Guards against SSRF: the server must never be
// tricked into reading internal addresses (localhost, private ranges, cloud metadata).

export function isPrivateAddress(address) {
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function safeLookup(allowPrivate) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const allowed = addresses.filter(a => allowPrivate || !isPrivateAddress(a.address));
      if (!allowed.length) return callback(new Error('Dit adres is niet toegestaan'));
      return options.all ? callback(null, allowed) : callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

function request(url, { allowPrivate, maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // IP literals skip DNS lookup, so check them directly.
    if (net.isIP(host) && !allowPrivate && isPrivateAddress(host)) return reject(new Error('Dit adres is niet toegestaan'));

    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      { lookup: safeLookup(allowPrivate), headers: { 'User-Agent': 'DomliBot/1.0', Accept: 'text/html,text/plain', 'Accept-Encoding': 'identity' }, timeout: timeoutMs },
      res => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) return fail(new Error('Pagina is te groot'));
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', fail);
      }
    );
    // Reject first, then destroy without an error argument: after the response started, an error passed to
    // destroy() is emitted on the socket and would crash the process if nothing listens for it.
    function fail(error) {
      reject(error);
      req.destroy();
    }
    req.on('socket', socket => socket.on('error', () => {}));
    req.on('timeout', () => fail(new Error('Pagina reageert niet')));
    req.on('error', reject);
  });
}

export function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const text = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: title.replace(/\s+/g, ' ').trim(), text };
}

export async function fetchPage(rawUrl, { allowPrivate = false, maxBytes = 2_000_000, timeoutMs = 10_000, maxRedirects = 3 } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Ongeldige link');
  }
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Alleen http- en https-links zijn toegestaan');
    const res = await request(url, { allowPrivate, maxBytes, timeoutMs });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.status !== 200) throw new Error(`Pagina gaf status ${res.status}`);
    const type = String(res.headers['content-type'] || '');
    if (!/text\/(html|plain)|application\/xhtml/.test(type)) throw new Error('Alleen webpagina\'s en tekst kunnen worden geïmporteerd');
    const page = /html/.test(type) ? htmlToText(res.body) : { title: '', text: res.body.trim() };
    return { url: url.toString(), title: page.title || url.hostname, text: page.text };
  }
  throw new Error('Te veel doorverwijzingen');
}
