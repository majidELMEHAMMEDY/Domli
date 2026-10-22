import { getAccount } from './config.js';
import { listDocs } from './knowledge/store.js';
import { retrieve } from './knowledge/chunk.js';
import { checkHandoff, isAppointmentIntent } from './guard.js';
import { askClaude } from './ai.js';
import { isOverCap, recordUsage } from './usage.js';
import { getAppointmentAdapter } from './appointments/index.js';
import { detectLanguage } from './lang.js';
import * as chatwoot from './chatwoot.js';

const HANDOFF_MESSAGE = {
  nl: 'Ik heb uw vraag doorgegeven aan een medewerker. U krijgt zo snel mogelijk antwoord.',
  en: "I've passed your question on to a colleague. You'll get a reply as soon as possible.",
};

// The bot receives every message of its inbox. Once a human has the conversation (assigned to a person, or opened
// and released after a handoff) the bot must stay out of it. Payloads without a status are treated as bot-handled.
export function shouldHandle(conversation) {
  if (!conversation?.status || conversation.status === 'pending') return true;
  return conversation.meta?.assignee_type === 'AgentBot' || conversation.meta?.assignee?.type === 'agent_bot';
}

const DRAFT_PREFIX = '💡 Conceptantwoord van de assistent (nog niet verstuurd):\n\n';

// Returns a short outcome string (also used by the tests).
export async function handleEvent(event, deps = { chatwoot, askClaude }) {
  if (event.event !== 'message_created' || event.message_type !== 'incoming' || event.private) return 'ignored';
  const text = (event.content || '').trim();
  if (!text) return 'ignored';

  if (!shouldHandle(event.conversation)) return 'human-handling';

  const accountId = event.account?.id;
  const conversationId = event.conversation?.id;
  const account = getAccount(accountId);
  if (!account) return 'disabled';

  const token = account.chatwootBotToken;
  // Order matters: open first, while the conversation is still pending. Domli then runs its own bot handoff
  // (releases the bot, notifies agents). Any message sent first would already flip it to "open" with the bot assigned.
  const handoff = async reason => {
    const language = detectLanguage(text);
    const steps = [
      () => deps.chatwoot.handoffToHuman(accountId, conversationId, token),
      () => deps.chatwoot.assignAgent(accountId, conversationId, token, account.handoffAgentId),
      () => deps.chatwoot.sendReply(accountId, conversationId, token, HANDOFF_MESSAGE[language]),
      () => deps.chatwoot.sendNote(accountId, conversationId, token, `🤝 Overgedragen aan een medewerker (reden: ${reason}).`),
    ];
    // Every step is attempted even if an earlier one fails: the visitor must always hear that a person will follow up.
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        console.error('handoff step failed:', error.message);
      }
    }
    return `handoff:${reason}`;
  };

  const answerPrices = account.answerPrices === true;
  const reason = checkHandoff(text, { skip: answerPrices ? ['prijs'] : [] });
  if (reason) return handoff(reason);

  const adapter = isAppointmentIntent(text) ? getAppointmentAdapter(account.appointments) : null;
  if (adapter) {
    await deps.chatwoot.sendReply(accountId, conversationId, token, await adapter.reply({ language: detectLanguage(text) }));
    return 'appointment';
  }

  if (isOverCap(accountId, account.monthlyTokenCap)) return handoff('maandlimiet bereikt');

  const knowledge = retrieve(listDocs(accountId), text);
  let result;
  try {
    result = await deps.askClaude({
      businessName: account.businessName,
      knowledge: knowledge.text,
      message: text,
      answerPrices,
      instructions: account.instructions || '',
    });
  } catch (error) {
    // A broken key or an outage must not leave the customer waiting: give the conversation to a person.
    console.error('ai error:', error.message);
    return handoff('technische fout');
  }
  const { decision, usage } = result;
  try {
    recordUsage(accountId, usage.input, usage.output);
  } catch (error) {
    // Counting tokens must never stop a customer from getting their answer.
    console.error('usage logging failed:', error.message);
  }

  if (decision.action === 'handoff') {
    return handoff(decision.reason || 'onzeker');
  }
  if (account.mode === 'auto') {
    await deps.chatwoot.sendReply(accountId, conversationId, token, decision.reply);
    return 'auto-reply';
  }
  const sources = knowledge.sources.length ? `\n\nBronnen: ${knowledge.sources.join(', ')}` : '';
  await deps.chatwoot.sendNote(accountId, conversationId, token, DRAFT_PREFIX + decision.reply + sources);
  return 'draft';
}
