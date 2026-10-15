import { env } from './config.js';

async function request(path, token, body) {
  const response = await fetch(`${env.chatwootUrl}/api/v1/accounts/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', api_access_token: token },
    body: JSON.stringify(body),
  });
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
