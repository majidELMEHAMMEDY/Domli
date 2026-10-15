import Anthropic from '@anthropic-ai/sdk';
import { env } from './config.js';

let client;
const getClient = () => (client ||= new Anthropic({ apiKey: env.anthropicKey }));

export function buildSystemPrompt(businessName, knowledge) {
  return `Je bent de klantenservice-assistent van ${businessName}. Je antwoordt in het Nederlands, kort, vriendelijk en zakelijk (u-vorm).

Gebruik UITSLUITEND de kennis hieronder. Verzin niets.
Kies "handoff" als:
- het antwoord niet in de kennis staat of je twijfelt,
- het over prijzen, offertes, facturen of betalingen gaat,
- het een klacht is,
- het over gezondheid of medische zaken gaat.

Antwoord ALLEEN met JSON: {"action":"answer"|"handoff","reply":"..."}
Bij "handoff" mag "reply" leeg zijn.

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
export async function askClaude({ businessName, knowledge, message }) {
  const response = await getClient().messages.create({
    model: env.model,
    max_tokens: 400,
    system: buildSystemPrompt(businessName, knowledge),
    messages: [{ role: 'user', content: message }],
  });
  const text = response.content.find(block => block.type === 'text')?.text || '';
  return {
    decision: parseDecision(text),
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}
