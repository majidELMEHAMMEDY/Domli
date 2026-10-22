import { getAccount } from './config.js';
import { listDocs } from './knowledge/store.js';
import { retrieve } from './knowledge/chunk.js';
import { firstMatch, renderMessage } from './rules.js';
import { askClaude } from './ai.js';
import { isOverCap, recordUsage } from './usage.js';
import { getAppointmentAdapter } from './appointments/index.js';
import { detectLanguage } from './lang.js';
import * as chatwoot from './chatwoot.js';

// The bot receives every message of its inbox. Once a human has the conversation (assigned to a person, or opened
// and released after a handoff) the bot must stay out of it. Payloads without a status are treated as bot-handled.
export function shouldHandle(conversation) {
  if (!conversation?.status || conversation.status === 'pending') return true;
  return conversation.meta?.assignee_type === 'AgentBot' || conversation.meta?.assignee?.type === 'agent_bot';
}

const DRAFT_PREFIX = '💡 Conceptantwoord van de assistent (nog niet verstuurd):\n\n';

// Visitor language, limited to the languages this customer allows (the first one is the fallback).
const languageFor = (text, account) => {
  const detected = detectLanguage(text);
  return account.languages.includes(detected) ? detected : account.languages[0];
};

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
  const language = languageFor(text, account);
  const render = template => renderMessage(template, { bookingUrl: account.appointments?.bookingUrl, business: account.businessName, assistant: account.assistantName });

  // Order matters: open first, while the conversation is still pending. Domli then runs its own bot handoff
  // (releases the bot, notifies agents). Any message sent first would already flip it to "open" with the bot assigned.
  const handoff = async (reason, message) => {
    const steps = [
      () => deps.chatwoot.handoffToHuman(accountId, conversationId, token),
      () => deps.chatwoot.assignAgent(accountId, conversationId, token, account.handoffAgentId),
      () => deps.chatwoot.sendReply(accountId, conversationId, token, render(message || account.handoffMessage[language])),
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

  // Delivers a fixed answer: to the visitor in auto mode, as a draft note otherwise.
  const deliver = async (reply, outcome) => {
    if (account.mode === 'auto') {
      await deps.chatwoot.sendReply(accountId, conversationId, token, reply);
      return outcome;
    }
    await deps.chatwoot.sendNote(accountId, conversationId, token, DRAFT_PREFIX + reply);
    return `${outcome}-draft`;
  };

  // 1. Hand-over rules (restrictions) come first, so sensitive messages never reach the AI.
  const handoffRule = firstMatch(account.rules, text, 'handoff');
  if (handoffRule) return handoff(handoffRule.reason || handoffRule.name, handoffRule.message[language] || undefined);

  // 2. Appointment questions: the customer's booking link, without the AI.
  const appointmentRule = firstMatch(account.rules, text, 'appointment');
  const adapter = appointmentRule ? getAppointmentAdapter(account.appointments) : null;
  if (adapter) {
    await deps.chatwoot.sendReply(accountId, conversationId, token, await adapter.reply({ language }));
    return 'appointment';
  }

  // 3. Quick replies: fixed answers to common small talk, without the AI.
  const replyRule = firstMatch(account.rules, text, 'reply');
  if (replyRule && replyRule.message[language]) return deliver(render(replyRule.message[language]), 'quick-reply');

  if (isOverCap(accountId, account.monthlyTokenCap)) return handoff('maandlimiet bereikt');

  // 4. Everything else goes to the AI, with this customer's rules, instructions and knowledge.
  const knowledge = retrieve(listDocs(accountId), text);
  let result;
  try {
    result = await deps.askClaude({
      businessName: account.businessName,
      assistantName: account.assistantName,
      languages: account.languages,
      unknownBehavior: account.unknownBehavior,
      promptTemplate: account.promptTemplate,
      rules: account.rules,
      instructions: account.instructions || '',
      model: account.model,
      knowledge: knowledge.text,
      message: text,
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

  if (decision.action === 'handoff') return handoff(decision.reason || 'onzeker');
  if (account.mode === 'auto') {
    await deps.chatwoot.sendReply(accountId, conversationId, token, decision.reply);
    return 'auto-reply';
  }
  const sources = knowledge.sources.length ? `\n\nBronnen: ${knowledge.sources.join(', ')}` : '';
  await deps.chatwoot.sendNote(accountId, conversationId, token, DRAFT_PREFIX + decision.reply + sources);
  return 'draft';
}
