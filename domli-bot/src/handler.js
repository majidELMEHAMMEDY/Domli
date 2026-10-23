import { getAccount, readAccount } from './config.js';
import { listDocs } from './knowledge/store.js';
import { retrieve } from './knowledge/chunk.js';
import { firstMatch, renderMessage } from './rules.js';
import { askClaude, buildSystemPrompt } from './ai.js';
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

const renderFor = account => template =>
  renderMessage(template, { bookingUrl: account.appointments?.bookingUrl, business: account.businessName, assistant: account.assistantName });

// Decides what to do with a visitor message, without doing it. Used by the live handler and by the Test tab.
// Order: hand-over rules, appointment rules, quick replies, then the AI.
export async function decide(account, accountId, text, deps = { askClaude }) {
  const language = languageFor(text, account);
  const render = renderFor(account);

  const handoffRule = firstMatch(account.rules, text, 'handoff');
  if (handoffRule) {
    return { type: 'handoff', language, rule: handoffRule.name, reason: handoffRule.reason || handoffRule.name, message: handoffRule.message[language] || '' };
  }

  const appointmentRule = firstMatch(account.rules, text, 'appointment');
  const adapter = appointmentRule ? getAppointmentAdapter(account.appointments) : null;
  if (adapter) return { type: 'appointment', language, rule: appointmentRule.name, reply: await adapter.reply({ language }) };

  const replyRule = firstMatch(account.rules, text, 'reply');
  if (replyRule && replyRule.message[language]) return { type: 'quick-reply', language, rule: replyRule.name, reply: render(replyRule.message[language]) };

  if (isOverCap(accountId, account.monthlyTokenCap)) return { type: 'handoff', language, rule: null, reason: 'maandlimiet bereikt', message: '' };

  const knowledge = retrieve(listDocs(accountId), text);
  const config = {
    businessName: account.businessName,
    assistantName: account.assistantName,
    languages: account.languages,
    unknownBehavior: account.unknownBehavior,
    promptTemplate: account.promptTemplate,
    rules: account.rules,
    instructions: account.instructions || '',
    model: account.model,
  };
  try {
    const result = await deps.askClaude({ ...config, knowledge: knowledge.text, message: text });
    return { type: 'ai', language, decision: result.decision, usage: result.usage, raw: result.raw, stopReason: result.stopReason, knowledge, prompt: buildSystemPrompt(config, knowledge.text) };
  } catch (error) {
    // A broken key or an outage must not leave the customer waiting: give the conversation to a person.
    console.error('ai error:', error.message);
    return { type: 'handoff', language, rule: null, reason: 'technische fout', message: '', error: error.message, prompt: buildSystemPrompt(config, knowledge.text) };
  }
}

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
  const render = renderFor(account);
  const language = languageFor(text, account);

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
  const deliver = async (reply, outcome, sources = '') => {
    if (account.mode === 'auto') {
      await deps.chatwoot.sendReply(accountId, conversationId, token, reply);
      return outcome;
    }
    await deps.chatwoot.sendNote(accountId, conversationId, token, DRAFT_PREFIX + reply + sources);
    return `${outcome}-draft`;
  };

  const decision = await decide(account, accountId, text, deps);
  switch (decision.type) {
    case 'handoff':
      return handoff(decision.reason, decision.message);
    case 'appointment':
      await deps.chatwoot.sendReply(accountId, conversationId, token, decision.reply);
      return 'appointment';
    case 'quick-reply':
      return deliver(decision.reply, 'quick-reply');
    default: {
      try {
        recordUsage(accountId, decision.usage.input, decision.usage.output);
      } catch (error) {
        // Counting tokens must never stop a customer from getting their answer.
        console.error('usage logging failed:', error.message);
      }
      if (decision.decision.action === 'handoff') return handoff(decision.decision.reason || 'onzeker');
      const sources = decision.knowledge.sources.length ? `\n\nBronnen: ${decision.knowledge.sources.join(', ')}` : '';
      if (account.mode === 'auto') {
        await deps.chatwoot.sendReply(accountId, conversationId, token, decision.decision.reply);
        return 'auto-reply';
      }
      await deps.chatwoot.sendNote(accountId, conversationId, token, DRAFT_PREFIX + decision.decision.reply + sources);
      return 'draft';
    }
  }
}

// What the Test tab shows: the decision for a message, without sending anything to anyone.
export async function dryRun(accountId, text, deps) {
  const account = readAccount(accountId);
  const result = await decide({ mode: 'draft', monthlyTokenCap: 2000000, ...account }, accountId, text, deps);
  return { ...result, knowledge: result.knowledge ? result.knowledge.sources : undefined };
}
