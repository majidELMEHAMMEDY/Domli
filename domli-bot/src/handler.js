import { getAccount } from './config.js';
import { listDocs } from './knowledge/store.js';
import { retrieve } from './knowledge/chunk.js';
import { checkHandoff, isAppointmentIntent } from './guard.js';
import { askClaude } from './ai.js';
import { isOverCap, recordUsage } from './usage.js';
import { getAppointmentAdapter } from './appointments/index.js';
import * as chatwoot from './chatwoot.js';

const DRAFT_PREFIX = '💡 Conceptantwoord van de assistent (nog niet verstuurd):\n\n';

// Returns a short outcome string (also used by the tests).
export async function handleEvent(event, deps = { chatwoot, askClaude }) {
  if (event.event !== 'message_created' || event.message_type !== 'incoming' || event.private) return 'ignored';
  const text = (event.content || '').trim();
  if (!text) return 'ignored';

  const accountId = event.account?.id;
  const conversationId = event.conversation?.id;
  const account = getAccount(accountId);
  if (!account) return 'disabled';

  const token = account.chatwootBotToken;
  const handoff = async reason => {
    await deps.chatwoot.sendNote(accountId, conversationId, token, `🤝 Overgedragen aan een medewerker (reden: ${reason}).`);
    await deps.chatwoot.handoffToHuman(accountId, conversationId, token);
    return `handoff:${reason}`;
  };

  const answerPrices = account.answerPrices === true;
  const reason = checkHandoff(text, { skip: answerPrices ? ['prijs'] : [] });
  if (reason) return handoff(reason);

  const adapter = isAppointmentIntent(text) ? getAppointmentAdapter(account.appointments) : null;
  if (adapter) {
    await deps.chatwoot.sendReply(accountId, conversationId, token, await adapter.reply());
    return 'appointment';
  }

  if (isOverCap(accountId, account.monthlyTokenCap)) return handoff('maandlimiet bereikt');

  const knowledge = retrieve(listDocs(accountId), text);
  const { decision, usage } = await deps.askClaude({
    businessName: account.businessName,
    knowledge: knowledge.text,
    message: text,
    answerPrices,
  });
  recordUsage(accountId, usage.input, usage.output);

  if (decision.action === 'handoff') return handoff('onzeker');
  if (account.mode === 'auto') {
    await deps.chatwoot.sendReply(accountId, conversationId, token, decision.reply);
    return 'auto-reply';
  }
  const sources = knowledge.sources.length ? `\n\nBronnen: ${knowledge.sources.join(', ')}` : '';
  await deps.chatwoot.sendNote(accountId, conversationId, token, DRAFT_PREFIX + decision.reply + sources);
  return 'draft';
}
