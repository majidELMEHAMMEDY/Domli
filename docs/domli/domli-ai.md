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

**Everything is managed in Super Admin -> Settings -> Assistant. No code change is ever needed to tune the assistant for a type of client.** The page has tabs:

| Tab | What you set |
|---|---|
| **Overview** | On/off, draft or auto-reply, status and usage, **presets** (apply a preset, save the current settings as your own preset, delete presets) |
| **Behavior** | Business and assistant name, languages (Dutch and/or English), what to do when it does not know the answer (hand over, or say so and offer help), your instructions, the standard hand-over message (Dutch/English), and under *Advanced* a model for this customer and the base rules text (placeholders `{{business}}`, `{{assistant_line}}`, `{{language_rule}}`, `{{unknown_rule}}`, `{{handoff_rule}}`) |
| **Restrictions** | Who gets the handed-over conversations, and the **hand-over rules**: each rule has an on/off switch, trigger words and phrases (one per line, `*` at the end matches word beginnings), and its own message to the visitor. Built-in rules: prices, complaints (locked on), health (locked on), demo or trial request, asks for a person, appointments (booking link). Add your own rules. |
| **Quick replies** | Instant answers without the AI (language question, greeting, thanks, and your own), with a word limit so they only catch short messages |
| **Knowledge** | Text and web pages |
| **Connection** | Connect to an inbox (one button), appointments |
| **Limits** | Monthly token limit and this month's usage |
| **Test** | Type a visitor message and see what the assistant would do: which rule catches it, the language it detected, what the visitor would get, and for AI answers the raw answer, knowledge used, token count and the full instruction sent to the AI. Nothing is sent to anyone and tests are not counted. Use this first whenever the assistant does something unexpected. |
| **Writing assistant** | Switch the dashboard's AI writing assistant (sparkle button: suggest a reply, rewrite, summarize) on or off per customer. Needs an OpenAI key (Settings -> Domli AI). Applies to all agents of a customer, not to single agents. |
| **Claude settings** | API key, default model, public address of the assistant service |

Rules are checked in this order: hand-over rules, appointment rules, quick replies, then the AI. The rules and their default wording live in data (`domli-bot/src/defaults.json`, `presets.json`), not in code; a customer's own copy is stored in the service and edited on the page. Complaints and health rules can be edited but never switched off, for safety.

**Two places decide whether a topic is handed over:** the rule's words (checked before the AI) and its *Description for the AI* (what the AI is told to hand over). If you narrow a rule's words, also adjust its description, otherwise the AI may still hand over. To let the assistant answer a topic completely, switch the rule off.

**Presets:** built-in **Sales** (answers prices, hands over only demo/trial/"talk to a person"), **Local business** (prices and complaints to a person, appointments to the booking link) and **Support**. Applying a preset overwrites that customer's rules, languages, unknown-question policy, hand-over message and **instructions**; knowledge, limits and the inbox connection stay. Set up a customer the way you like, then *Save as preset* to reuse it for the next client of that type.

The page talks to the assistant service from the server, so none of the secrets reach the browser.

**One-time connection** (on the VPS). Rails needs the assistant service's admin token; everything else is then set on the page:
```bash
cd /opt/domli
echo "DOMLI_BOT_ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' domli-bot/.env | cut -d= -f2)" >> .env
docker compose -f docker-compose.production.yml up -d rails
```
The bot's `.env` still needs `BOT_WEBHOOK_SECRET` and `ADMIN_TOKEN`. `ANTHROPIC_API_KEY` there is now only a fallback: a key saved on the page takes priority. If Claude cannot be reached (wrong key, outage) the assistant hands the conversation to a person instead of leaving the visitor waiting.

The bot's own admin page (`https://bot.domli.nl/admin`) still works for knowledge, instructions and on/off.

- **Knowledge base:** text and web pages, managed on the admin page `/admin` of the bot (token protected). Small knowledge is sent whole, larger knowledge is searched.
- **Modes:** draft (private note for an agent, default) or auto-reply. Switchable per customer, also from the admin page.
- **Handoff:** complaints and medical topics always go to a human. Prices go to a human too, except for accounts with `"answerPrices": true` (use this only for Domli's own sales chat).
- **Handoff (verified end to end on a test Domli):** when the assistant hands a conversation to a person it (1) opens the conversation first, so Domli's own bot-handoff runs and releases the bot, (2) assigns it to the person chosen under **Hand over to**, (3) tells the visitor in their language ("I've passed your question on to a colleague..."), (4) leaves a private note with the reason. The chosen person gets a notification (bell, push, email). They must be an agent of that account and a **collaborator of the inbox** (Settings -> Inboxes -> inbox -> Collaborators), otherwise Domli does not notify them. With nobody chosen the conversation just becomes open and unassigned, and only agents who turned on "A new conversation is created" in Profile settings -> Notifications are notified.
- **After a handoff the assistant stays out of that conversation** (it ignores messages once a person has it), so it never talks over your team.
- **Languages:** the assistant answers in the visitor's language (Dutch or English); fixed texts (handoff message, booking link) follow the same detection, and the price/complaint/medical keyword checks know both languages.
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
