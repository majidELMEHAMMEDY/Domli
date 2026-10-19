# domli-bot

AI assistant and appointments helper for Domli. It is a **separate service** (Node.js, no Rails changes): Chatwoot calls it through the agent-bot webhook, it answers through the Chatwoot API.

## What it does
For every incoming customer message on a bot-connected inbox:
1. **Handoff rules first (no AI call):** prices, complaints, medical topics -> private note + conversation opened for a human. These messages never leave your server.
2. **Appointment intent** ("afspraak", "boeken", ...) -> sends the client's booking link (or OnlineAfspraken availability, see [appointments](../docs/domli/appointments.md)). No AI call.
3. Otherwise asks Claude with the client's knowledge (documents and web pages, see below):
   - `mode: "draft"` (default): posts a **private note** with a suggested reply for the agent.
   - `mode: "auto"`: sends the reply to the customer.
   - If Claude is unsure (or returns anything unparseable): handoff.
4. If the account reached its **monthly token cap**: handoff.

Data minimisation: only the single message text is sent to Claude, no name, email, phone or history. Logs contain token counts only (`data/tokens.log`), never message content.

## Managed from the super admin
Everything below (API key, model, customers, instructions, knowledge, appointments, connecting to an inbox) is managed on **Super Admin -> Settings -> Assistant** (see docs/domli/domli-ai.md). Global settings are stored in `data/settings.json` (permissions 600); customers in `data/accounts.json`. Secrets are write-only through the API.

## Knowledge and admin page
Open `https://<bot host>/admin` (needs `ADMIN_TOKEN` in `.env`; without it the page is disabled). Choose the customer, then:
- paste text (FAQ, opening hours, how you work), or
- import a public web page. The server fetches it, strips menus and scripts, and stores the text. Internal addresses are blocked, pages over 2 MB are refused.
You can also write **instructions** for the assistant (name, tone, things to always mention or avoid; max 2,000 characters) and switch it on/off and choose draft or auto-reply there. Instructions are added to the prompt after the fixed safety rules, so they can never override the handoff rules.

Knowledge is stored as JSON per document in `knowledge/<accountId>/`. A legacy `knowledge/<accountId>.md` file still works as one document. Up to 200 documents of 100,000 characters each. Small knowledge (under about 6,000 characters) is sent whole; larger knowledge is searched (BM25, no extra AI provider needed) and the best passages are sent. Draft notes list the sources used.

The admin API locks a client out for 10 minutes after 10 wrong tokens. Use a long random `ADMIN_TOKEN`.

`"answerPrices": true` on an account lets the assistant mention prices that are in its knowledge (for Domli's own sales chat). Complaints and medical topics are always handed off.

## Turn it off
- Per account: set `"enabled": false` in `data/accounts.json` (read on every message, no restart), or detach the bot from the inbox in Chatwoot.
- Everywhere: stop the container.

## Setup
```bash
cp .env.example .env            # set BOT_WEBHOOK_SECRET, ANTHROPIC_API_KEY, CHATWOOT_URL
cp data/accounts.example.json data/accounts.json
# knowledge: use the admin page (/admin), or drop a markdown file in knowledge/<accountId>.md
npm install && npm start        # or: docker compose -f ../docker-compose.production.yml up -d bot
```
In Chatwoot (as the client's administrator): Settings -> Bots -> Add bot, outgoing URL `http://bot:3100/webhook/<BOT_WEBHOOK_SECRET>` (or `https://bot.domli.nl/webhook/...`). Copy the bot's **access token** into `chatwootBotToken` for that account. Then Inbox settings -> Configuration -> choose the bot. Bot-connected conversations start as *pending* and are opened for humans on handoff.

`accounts.json` fields: `businessName`, `enabled`, `mode` (`draft`|`auto`), `answerPrices`, `chatwootBotToken`, `monthlyTokenCap` (default 2,000,000 tokens, roughly 900 answered questions with a ~2,000-token FAQ), `appointments` (`provider`: `link`|`onlineafspraken`, `bookingUrl`, ...).

## Safety notes
- The webhook URL contains a secret; keep `BOT_WEBHOOK_SECRET` long and random.
- `accounts.json` holds API tokens: keep it out of git (it is git-ignored).
- Health (healthcare) topics are out of scope: they are always handed off.
- Handoff keyword rules are in `src/guard.js` (Dutch, regex). They are a first line of defence, not a guarantee: keep `draft` mode as default and review drafts for new clients.

## Tests
`npm test` runs unit tests with mocked Chatwoot and Claude (no network, no key needed).

## Not verified yet
End-to-end run against a live Chatwoot and the Claude API (needs the running stack and a key). The Chatwoot API endpoints used are `POST /api/v1/accounts/{id}/conversations/{id}/messages` and `/toggle_status`; confirm in your running instance.
