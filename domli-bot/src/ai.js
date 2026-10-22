import Anthropic from '@anthropic-ai/sdk';
import { effectiveSettings } from './settings.js';

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

export function buildSystemPrompt(businessName, knowledge, { answerPrices = false, instructions = '' } = {}) {
  const priceRule = answerPrices
    ? '- het over offertes, facturen of betalingen gaat (algemene prijzen mag je noemen als ze in de kennis staan),'
    : '- het over prijzen, offertes, facturen of betalingen gaat,';
  return `Je bent de klantenservice-assistent van ${businessName}. Je antwoordt kort, vriendelijk en zakelijk, in de taal van de klant: Nederlands of Engels (schrijft de klant een andere taal, antwoord dan in het Engels). In het Nederlands gebruik je de u-vorm. De kennis hieronder is deels Nederlands: vertaal het antwoord naar de taal van de klant.

Gebruik UITSLUITEND de kennis hieronder. Verzin niets.
Kies "handoff" als:
- het antwoord niet in de kennis staat of je twijfelt,
${priceRule}
- het een klacht is,
- het over gezondheid of medische zaken gaat.

Antwoord ALLEEN met JSON: {"action":"answer"|"handoff","reply":"..."}
Bij "handoff" mag "reply" leeg zijn.

${instructions ? `\nExtra instructies van de eigenaar (de regels hierboven gaan altijd voor):\n<instructies>\n${instructions}\n</instructies>\n` : ''}
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
  } catch {
    // fall through: anything unparseable is a handoff
  }
  return { action: 'handoff', reply: '' };
}

// Only the single customer message is sent, no names, emails or history.
export async function askClaude({ businessName, knowledge, message, answerPrices = false, instructions = '' }) {
  const { anthropicApiKey, model } = effectiveSettings();
  const response = await getClient(anthropicApiKey).messages.create({
    model,
    max_tokens: 600,
    // Haiku 5.5 thinks by default and bills thinking as output: FAQ answers need neither, and thinking could eat the token budget.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: buildSystemPrompt(businessName, knowledge, { answerPrices, instructions }),
    messages: [{ role: 'user', content: message }],
  });
  const text = response.content.find(block => block.type === 'text')?.text || '';
  return {
    decision: parseDecision(text),
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}
