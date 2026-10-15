# domli-bot

AI assistant and appointments helper for Domli. It is a **separate service** (Node.js, no Rails changes): Chatwoot calls it through the agent-bot webhook, it answers through the Chatwoot API.

## What it does
For every incoming customer message on a bot-connected inbox:
1. **Handoff rules first (no AI call):** prices, complaints, medical topics -> private note + conversation opened for a human. These messages never leave your server.
2. **Appointment intent** ("afspraak", "boeken", ...) -> sends the client's booking link (or OnlineAfspraken availability, see [appointments](../docs/domli/appointments.md)). No AI call.
3. Otherwise asks Claude with the client's FAQ (`knowledge/<accountId>.md`):
   - `mode: "draft"` (default): posts a **private note** with a suggested reply for the agent.
   - `mode: "auto"`: sends the reply to the customer.
   - If Claude is unsure (or returns anything unparseable): handoff.
4. If the account reached its **monthly token cap**: handoff.

Data minimisation: only the single message text is sent to Claude, no name, email, phone or history. Logs contain token counts only (`data/tokens.log`), never message content.

## Turn it off
- Per account: set `"enabled": false` in `data/accounts.json` (read on every message, no restart), or detach the bot from the inbox in Chatwoot.
- Everywhere: stop the container.

## Setup
```bash
cp .env.example .env            # set BOT_WEBHOOK_SECRET, ANTHROPIC_API_KEY, CHATWOOT_URL
cp data/accounts.example.json data/accounts.json
cp knowledge/example.md knowledge/<accountId>.md   # the client's FAQ, plain markdown
npm install && npm start        # or: docker compose -f ../docker-compose.production.yml up -d bot
```
In Chatwoot (as the client's administrator): Settings -> Bots -> Add bot, outgoing URL `http://bot:3100/webhook/<BOT_WEBHOOK_SECRET>` (or `https://bot.domli.nl/webhook/...`). Copy the bot's **access token** into `chatwootBotToken` for that account. Then Inbox settings -> Configuration -> choose the bot. Bot-connected conversations start as *pending* and are opened for humans on handoff.

`accounts.json` fields: `businessName`, `enabled`, `mode` (`draft`|`auto`), `chatwootBotToken`, `monthlyTokenCap` (default 100000 tokens), `appointments` (`provider`: `link`|`onlineafspraken`, `bookingUrl`, ...).

## Safety notes
- The webhook URL contains a secret; keep `BOT_WEBHOOK_SECRET` long and random.
- `accounts.json` holds API tokens: keep it out of git (it is git-ignored).
- Health (healthcare) topics are out of scope: they are always handed off.
- Handoff keyword rules are in `src/guard.js` (Dutch, regex). They are a first line of defence, not a guarantee: keep `draft` mode as default and review drafts for new clients.

## Tests
`npm test` runs unit tests with mocked Chatwoot and Claude (no network, no key needed).

## Not verified yet
End-to-end run against a live Chatwoot and the Claude API (needs the running stack and a key). The Chatwoot API endpoints used are `POST /api/v1/accounts/{id}/conversations/{id}/messages` and `/toggle_status`; confirm in your running instance.
