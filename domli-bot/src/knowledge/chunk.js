// Splits knowledge into chunks and picks the ones relevant to a question.
// Small knowledge bases (the normal case for a small business) are sent whole; only larger ones are filtered.

const STOP = new Set(
  'de het een en van te in is dat die op voor met niet zijn er aan ook als om ik je u we wij jullie hoe wat waar wanneer kan kunnen mijn uw the a of to and'.split(' ')
);

export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 1 && !STOP.has(token));
}

export function chunkText(text, maxLen = 800) {
  const chunks = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    const part = paragraph.trim();
    if (!part) continue;
    if (part.length > maxLen) {
      push();
      for (let i = 0; i < part.length; i += maxLen) chunks.push(part.slice(i, i + maxLen));
    } else if ((current + '\n\n' + part).length > maxLen) {
      push();
      current = part;
    } else {
      current = current ? `${current}\n\n${part}` : part;
    }
  }
  push();
  return chunks;
}

function bm25(chunks, queryTokens) {
  const k1 = 1.5;
  const b = 0.75;
  const tokenized = chunks.map(chunk => tokenize(chunk.text));
  const avgLen = tokenized.reduce((sum, t) => sum + t.length, 0) / (chunks.length || 1) || 1;
  const docFreq = new Map();
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) docFreq.set(token, (docFreq.get(token) || 0) + 1);
  }
  return chunks.map((chunk, i) => {
    const tokens = tokenized[i];
    let score = 0;
    for (const q of new Set(queryTokens)) {
      const tf = tokens.filter(t => t === q).length;
      if (!tf) continue;
      const df = docFreq.get(q) || 0;
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * tokens.length) / avgLen));
    }
    return { chunk, score };
  });
}

// docs: [{ id, title, text }]  ->  { text, sources: [titles] }
export function retrieve(docs, query, { maxChars = 6000 } = {}) {
  const chunks = docs.flatMap(doc => chunkText(doc.text).map(text => ({ title: doc.title, text })));
  const total = chunks.reduce((sum, c) => sum + c.text.length, 0);

  let selected = chunks;
  if (total > maxChars) {
    const ranked = bm25(chunks, tokenize(query)).filter(r => r.score > 0).sort((a, z) => z.score - a.score);
    selected = [];
    let used = 0;
    for (const { chunk } of ranked) {
      if (used + chunk.text.length > maxChars) continue;
      selected.push(chunk);
      used += chunk.text.length;
    }
  }
  return {
    text: selected.map(c => `### ${c.title}\n${c.text}`).join('\n\n'),
    sources: [...new Set(selected.map(c => c.title))],
  };
}
