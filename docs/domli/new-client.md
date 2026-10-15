# New client account

Domli is multi-tenant: one installation, one **Account** per client. Public signup is off (`ENABLE_ACCOUNT_SIGNUP=false`), so you create accounts.

## Create an account and invite the owner
**Super Admin (recommended):** `https://app.domli.nl/super_admin` -> Accounts -> New (name, locale `nl`) -> Users -> New (name, e-mail, password or confirmation mail) -> Account Users -> New: user + account, role `administrator`. The owner then logs in at `https://app.domli.nl` and invites their own team under Settings -> Agents.

**CLI alternative** (creates account, owner and administrator link in one go; untested in this fork, try on staging first):
```bash
docker compose -f docker-compose.production.yml exec rails bundle exec rails runner '
AccountBuilder.new(account_name: "Kapsalon De Vries", user_full_name: "Jan de Vries",
                   email: "jan@devries.nl", user_password: "TEMP-CHANGE-ME", confirmed: true).perform'
```

## Then, for the client
1. Website inbox + snippet: [widget.md](widget.md)
2. Email inbox: Settings -> Inboxes -> Add -> Email (IMAP/SMTP or forwarding)
3. WhatsApp: [whatsapp-nl.md](whatsapp-nl.md)
4. AI assistant (optional): create an agent bot (Settings -> Bots) pointing at `https://bot.domli.nl/webhook/<BOT_WEBHOOK_SECRET>` (or `http://bot:3100/webhook/<secret>`), attach it to the inbox, add the account to `domli-bot/data/accounts.json` and its FAQ to `domli-bot/knowledge/<accountId>.md`. Details: [domli-bot/README.md](../../domli-bot/README.md)

## Default features for new accounts
New accounts start with a small feature set. Disabled by default (`config/features.yml`): help center, macros, automations, campaigns, companies, TikTok, Captain tasks, mobile voice push, contact-support chat. Enable per account in Super Admin -> Accounts -> (account) -> Features. Existing accounts keep their current flags.

## Tenant isolation: what to verify
Chatwoot scopes agents, inboxes, contacts and conversations by `account_id` and checks account membership on every API call. **This has not yet been tested on this fork.** Before the first paying client, with two test accounts A and B (users `a@test`, `b@test`):
1. As A create an inbox, a contact and a conversation. Note their IDs.
2. Log in as B. Check the lists in the UI show nothing from A.
3. With B's API token (Profile settings -> Access token) request A's data: `curl -H "api_access_token: <B token>" https://app.domli.nl/api/v1/accounts/<A id>/conversations/<A conv id>` must return 401/404, not data.
4. Same for `/contacts/<id>` and `/inboxes`.
5. Search (as B) for a word that only exists in A's conversations: no hits.
6. Webhook/bot: confirm B's bot token cannot post into A's conversation (`POST /api/v1/accounts/<A id>/conversations/<id>/messages` with B's token -> 401).
Tick these off here with the date: `____`. The bot additionally refuses accounts that are not listed and enabled in `accounts.json`.
