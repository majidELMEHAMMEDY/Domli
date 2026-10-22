import { env } from './config.js';

async function request(path, token, body) {
  let response;
  try {
    response = await fetch(`${env.chatwootUrl}/api/v1/accounts/${path}`, {
      method: 'POST',
      // The internal address is plain http. Domli forces https, so tell it the original request was secure,
      // otherwise it redirects to https://rails:3000 and the connection fails.
      headers: { 'Content-Type': 'application/json', api_access_token: token, 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  } catch (error) {
    throw new Error(`Domli niet bereikbaar op ${env.chatwootUrl || '(CHATWOOT_URL niet ingesteld)'}: ${error.cause?.code || error.cause?.errors?.[0]?.code || error.message}`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Domli stuurde door naar ${response.headers.get('location')} (controleer CHATWOOT_URL)`);
  }
  if (!response.ok) throw new Error(`Chatwoot API ${response.status} on ${path.split('/').slice(2).join('/')}`);
}

const messagesPath = (accountId, conversationId) => `${accountId}/conversations/${conversationId}/messages`;

// Public reply, the customer sees it.
export const sendReply = (accountId, conversationId, token, content) =>
  request(messagesPath(accountId, conversationId), token, { content, message_type: 'outgoing', private: false });

// Private note, only agents see it. Used for drafts and handoff reasons.
export const sendNote = (accountId, conversationId, token, content) =>
  request(messagesPath(accountId, conversationId), token, { content, message_type: 'outgoing', private: true });

// Opens the conversation so it appears for human agents.
export const handoffToHuman = (accountId, conversationId, token) =>
  request(`${accountId}/conversations/${conversationId}/toggle_status`, token, { status: 'open' });

// Assigns the conversation to a human agent (notifies that agent). With no agent it only releases the bot,
// so the conversation shows as unassigned for the team.
export const assignAgent = (accountId, conversationId, token, agentId) =>
  request(`${accountId}/conversations/${conversationId}/assignments`, token, { assignee_id: agentId || null });
