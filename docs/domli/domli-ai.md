# Domli AI

Domli AI has two parts. Both were built from scratch for Domli (no code from the non-MIT enterprise folder).

## 1. Writing assistant (inside the dashboard)
Rewrite and change tone, summarize a conversation, suggest a reply, ask a question about a conversation. This is code that ships in the MIT core. In the interface it is now called **Domli AI**.

It is **off by default**, because it needs an AI key. It talks to an OpenAI-style API and always calls `<endpoint>/v1/chat/completions`, with models from `config/llm.yml` (default `gpt-4.1-mini`). Providers whose compatible URL does not end in `/v1` (for example Google's Gemini endpoint) do **not** work without a code change.

Turn it on (run on the VPS; replace the key):
```bash
cd /opt/domli
docker compose -f docker-compose.production.yml exec rails bundle exec rails runner '
InstallationConfig.where(name: "CAPTAIN_OPEN_AI_API_KEY").first_or_initialize.update!(value: "sk-YOUR-KEY")
GlobalConfig.clear_cache
Account.find(1).enable_features("captain_tasks")
puts "enabled"'
```
Other accounts: Super Admin -> Accounts -> account -> Features -> "Domli AI Tasks". The key is shared by all accounts, so every customer's usage is billed to you: keep it in your cost estimate.

Data note: the text of the conversation is sent to the AI provider. Add the provider to the [subprocessor list](privacy/subprocessors.md) and use a paid/API plan whose terms say your data is not used for training.

## 2. AI Assistant (answers customers, `domli-bot`)
Answers incoming messages from the business's own knowledge. See [domli-bot/README.md](../../domli-bot/README.md).

- **Knowledge base:** text and web pages, managed on the admin page `/admin` of the bot (token protected). Small knowledge is sent whole, larger knowledge is searched.
- **Modes:** draft (private note for an agent, default) or auto-reply. Switchable per customer, also from the admin page.
- **Handoff:** complaints and medical topics always go to a human. Prices go to a human too, except for accounts with `"answerPrices": true` (use this only for Domli's own sales chat).
- **Cost control:** monthly token cap per account, token log without message content.
- **Privacy:** only the single customer message and relevant knowledge go to the AI. No name, email, phone or history.

### Domli's own sales chat (get clients)
1. In Domli (account 1) create a website inbox for domli.nl (already done for the widget) and turn on the **pre-chat form** (asks name and email).
2. Settings -> Bots -> add a bot, outgoing URL `https://bot.domli.nl/webhook/<BOT_WEBHOOK_SECRET>`. Copy its access token into `accounts.json` and connect the bot to the website inbox.
3. In `domli-bot/data/accounts.json`, account `1` is Domli: `"answerPrices": true`, booking link `https://domli.nl/#contact`.
4. Open `https://bot.domli.nl/admin`, choose Domli, and add the text from `domli-bot/knowledge/domli-sales.example.md` as knowledge.
5. Keep mode `draft` for the first week. Read the drafts, fix the knowledge, then consider `auto`.

## Deploy on the VPS (nginx in front)
```bash
# copy the bot (Mac terminal, from the repo folder)
rsync -a --exclude node_modules domli-bot root@YOUR_VPS_IP:/opt/domli/
# on the VPS
cd /opt/domli/domli-bot
cp .env.example .env && cp data/accounts.example.json data/accounts.json
nano .env                                  # BOT_WEBHOOK_SECRET, ADMIN_TOKEN (openssl rand -hex 32), ANTHROPIC_API_KEY
chown -R 1000:1000 data knowledge          # the bot runs as user "node"
cd .. && docker compose -f docker-compose.production.yml up -d --build bot
```
DNS: an A record `bot` -> your VPS IP. nginx: see `deployment/nginx-bot.conf`, then `certbot --nginx -d bot.domli.nl`.
