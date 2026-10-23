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

export function parseDecision(text) {
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (json.action === 'answer' && typeof json.reply === 'string' && json.reply.trim()) {
      return { action: 'answer', reply: json.reply.trim() };
    }
    if (json.action === 'handoff') return { action: 'handoff', reply: '', reason: 'buiten de kennis' };
  } catch {
    // fall through: anything unparseable is a handoff
  }
  return { action: 'handoff', reply: '', reason: 'ongeldig AI-antwoord' };
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
