import Anthropic from '@anthropic-ai/sdk';
import { effectiveSettings } from './settings.js';
import { DEFAULTS } from './rules.js';

let client;
let clientKey;
function getClient(apiKey) {
  if (!apiKey) throw new Error('Geen Anthropic API-sleutel ingesteld');
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

// The wording of the rules lives in the customer's settings (rules.js / defaults.json), edited in the super admin.
// Only the technical contract (JSON answer, knowledge and instruction blocks) is fixed here.
export function buildSystemPrompt(config, knowledge) {
  const {
    businessName = '',
    assistantName = '',
    languages = DEFAULTS.languages,
    unknownBehavior = DEFAULTS.unknownBehavior,
    promptTemplate = DEFAULTS.promptTemplate,
    rules = [],
    instructions = '',
  } = config;

  const handoffRules = rules.filter(rule => rule.type === 'handoff');
  const topics = handoffRules.filter(rule => rule.enabled && rule.promptHint).map(rule => rule.promptHint);
  const notes = handoffRules.filter(rule => !rule.enabled && rule.disabledNote).map(rule => rule.disabledNote);
  const handoffRule = [topics.length ? `Kies "handoff" ook als het gaat om: ${topics.join('; ')}.` : '', ...notes].filter(Boolean).join(' ');

  const values = {
    business: businessName,
    assistant_line: assistantName ? ` Je heet ${assistantName}.` : '',
    language_rule: DEFAULTS.languageRules[languages.length > 1 ? 'nl+en' : languages[0]] || DEFAULTS.languageRules['nl+en'],
    unknown_rule: DEFAULTS.unknownRules[unknownBehavior] || DEFAULTS.unknownRules.handoff,
    handoff_rule: handoffRule,
  };
  const body = (promptTemplate || DEFAULTS.promptTemplate).replace(/\{\{(\w+)\}\}/g, (match, key) => (key in values ? values[key] : match));

  return `${body}

Antwoord ALLEEN met JSON: {"action":"answer"|"handoff","reply":"..."}
Bij "handoff" mag "reply" leeg zijn.

${instructions ? `Extra instructies van de eigenaar (de regels hierboven gaan altijd voor):\n<instructies>\n${instructions}\n</instructies>\n` : ''}
<kennis>
${knowledge}
</kennis>`;
}

const INVALID = { action: 'handoff', reply: '', reason: 'ongeldig AI-antwoord' };

// Models often put real line breaks inside the JSON string (a list of plans, for example), which strict JSON forbids.
function escapeControlCharsInStrings(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString && !escaped && char === '\n') out += '\\n';
    else if (inString && !escaped && char === '\r') out += '\\r';
    else if (inString && !escaped && char === '\t') out += '\\t';
    else out += char;
    if (escaped) escaped = false;
    else if (char === '\\' && inString) escaped = true;
    else if (char === '"') inString = !inString;
  }
  return out;
}

function fromJson(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.action === 'handoff') return { action: 'handoff', reply: '', reason: 'buiten de kennis' };
  if (typeof json.reply === 'string' && json.reply.trim()) return { action: 'answer', reply: json.reply.trim() };
  return null;
}

// Last resort for JSON that is broken in some other way (for example unescaped quotes inside the reply).
function lenientReply(candidate) {
  const start = /"reply"\s*:\s*"/.exec(candidate);
  const end = candidate.lastIndexOf('"');
  if (!start || end <= start.index + start[0].length) return '';
  return candidate
    .slice(start.index + start[0].length, end)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\')
    .trim();
}

// Reads the model's answer. Anything that clearly is an answer is delivered; only an unreadable or empty
// answer becomes a handoff.
export function parseDecision(text) {
  const trimmed = String(text || '').trim();
  const open = trimmed.indexOf('{');
  const close = trimmed.lastIndexOf('}');

  if (open !== -1 && close > open) {
    const candidate = trimmed.slice(open, close + 1);
    for (const attempt of [candidate, escapeControlCharsInStrings(candidate)]) {
      try {
        const decision = fromJson(JSON.parse(attempt));
        if (decision) return decision;
      } catch {
        // try the next, more tolerant reading
      }
    }
    const action = /"action"\s*:\s*"(answer|handoff)"/.exec(candidate)?.[1];
    if (action === 'handoff') return { action: 'handoff', reply: '', reason: 'buiten de kennis' };
    const reply = action === 'answer' ? lenientReply(candidate) : '';
    return reply ? { action: 'answer', reply } : { ...INVALID };
  }

  // No JSON at all: the model just wrote its answer. A cut-off JSON start ("{...") is not an answer.
  if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) return { action: 'answer', reply: trimmed.replace(/^```\w*\s*|\s*```$/g, '').trim() };
  return { ...INVALID };
}

// Only the single customer message is sent, no names, emails or history.
export async function askClaude({ knowledge, message, ...config }) {
  const { anthropicApiKey, model: globalModel } = effectiveSettings();
  const response = await getClient(anthropicApiKey).messages.create({
    model: config.model || globalModel,
    max_tokens: 600,
    // Haiku 5.5 thinks by default and bills thinking as output: FAQ answers need neither, and thinking could eat the token budget.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: buildSystemPrompt(config, knowledge),
    messages: [{ role: 'user', content: message }],
  });
  const text = response.content.find(block => block.type === 'text')?.text || '';
  const decision = parseDecision(text);
  const blocks = response.content.map(block => block.type).join(',') || 'none';

  if (decision.reason === 'ongeldig AI-antwoord') {
    // Say why, without logging customer content: usually a cut-off or refused answer.
    if (response.stop_reason === 'max_tokens') decision.reason = 'AI-antwoord afgekapt';
    else if (response.stop_reason === 'refusal') decision.reason = 'AI weigerde te antwoorden';
    console.warn(`AI-antwoord onbruikbaar: stop_reason=${response.stop_reason} blokken=${blocks} lengte=${text.length}`);
  }
  // Temporary troubleshooting switch (DEBUG_AI_OUTPUT=1): logs what the model returned. This includes text derived from
  // the customer's message, so turn it off again afterwards.
  if (process.env.DEBUG_AI_OUTPUT === '1') {
    console.log(`AI debug: stop_reason=${response.stop_reason} blokken=${blocks} tekst=${JSON.stringify(text.slice(0, 600))}`);
  }
  return {
    decision,
    raw: text,
    stopReason: response.stop_reason,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}
