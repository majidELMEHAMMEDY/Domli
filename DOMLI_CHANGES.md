# Domli changes to upstream Chatwoot files

Base: Chatwoot 4.18.0 (commit a0dfab928). Keep this list current so upstream merges stay easy.
Domli-only files (no merge conflicts): `landing/` (domli.nl PHP site), `branding/`, `docs/domli/`, `domli-bot/`, `scripts/domli/`, `deployment/Caddyfile`, `docker-compose.production.yml`, `.env.production.example`, `.github/workflows/publish_domli_image.yml`, `config/locales/domli.nl.yml`, `config/locales/domli.en.yml`, `app/controllers/super_admin/domli_ai_controller.rb`, `app/views/super_admin/domli_ai/`, `app/services/domli_ai/`, `NOTICE`, `DOMLI_CHANGES.md`.

| Path | Change | Reason |
|---|---|---|
| `enterprise/`, `spec/enterprise/` | Deleted | Community (MIT) edition only. On upstream merges, keep these deleted. |
| `lib/chatwoot_hub.rb` | `sync_with_hub`, `register_instance`, `emit_event` are no-ops | Never contact the Chatwoot hub (no ping, registration, telemetry). `send_push` is untouched (only used by the Chatwoot mobile app). |
| `config/installation_config.yml` | Brand name/URLs/terms/privacy changed to Domli / domli.nl | Rebrand through the supported installation config. |
| `public/brand-assets/*`, `public/*.png`, `public/manifest.json` | Domli logos and icons (generated from `branding/domli-logo.png`) | Rebrand. |
| `public/404.html`, `422.html`, `500.html` | Brand color | Rebrand. |
| `app/javascript/dashboard/assets/scss/_next-colors.scss` | `--blue-*` scale replaced by Domli teal | Central brand color (change here). |
| `theme/colors.js`, `components-next/icon/Logo.vue`, `layouts/vueapp.html.erb`, `layouts/mailer/base.liquid`, `devise/mailer/_confirmation_body.html.erb`, `superadmin_pages/.../Index.vue` | `#2781F6` -> `#00969C` | Brand color. |
| `app/javascript/{dashboard,widget,survey}/i18n/locale/{en,nl}`, `config/locales/{en,nl,devise.en,devise.nl}.yml` | "Chatwoot" -> "Domli" in strings; terms/privacy URLs | Rebrand. Other languages untouched (Crowdin). |
| mailers, `.liquid` mail templates, super admin views, `mfa/management_service.rb`, `push_test_service.rb`, leadsquared services, `config/initializers/devise.rb` | Hardcoded "Chatwoot" / sender -> Domli / `noreply@domli.nl` | Rebrand. |
| `config/features.yml` | `enabled: false` for help_center, macros, automations, campaigns, companies, captain_tasks, contact_chatwoot_support_team, channel_tiktok, mobile_voice_push | Simpler default feature set for new small-business accounts (flags only affect new accounts). |
| `docker/Dockerfile` | `ENV CW_EDITION="ce"` appended | Mark the image as Community edition. |
| `.dockerignore` | Ignore `domli-bot`, `docs`, `branding` | Smaller build context. |
| `app/views/layouts/super_admin/application.html.erb` | Page title uses `INSTALLATION_NAME` instead of `application_title` | Super admin tab titles said "Chatwoot". |
| `config/features.yml` (display names), `*/i18n/locale/{en,nl}/*.json`, `config/locales/{en,nl}.yml` | "Captain" renamed to "Domli AI" in visible strings | Domli AI branding of the built-in AI writing assistant. |
| `app/helpers/super_admin/features.yml` | `captain` entry name/description -> "Domli AI" | Super admin sidebar and settings card label. |
| `config/installation_config.yml` | "Captain" -> "Domli AI" in display titles and descriptions | Labels on the super admin Domli AI settings page. |
| `lib/llm/config.rb`, `lib/captain/base_task_service.rb`, `app/models/installation_config.rb`, `app/controllers/super_admin/app_configs_controller.rb`, `config/installation_config.yml`, `config/llm.yml` | Anthropic key `CAPTAIN_ANTHROPIC_API_KEY` passed to ruby_llm; Claude model ids fixed to registry ids; `claude-haiku-4-5` enabled and default for the `editor` feature | The writing assistant runs on the same Claude API as the bot, no OpenAI account needed. |
| `config/routes.rb` | 10 routes under `super_admin` for `domli_ai` | Super admin page that manages the Domli AI assistant. |
| `app/helpers/super_admin/navigation_helper.rb` | "Assistant" entry next to the Domli AI settings; `settings_open?` includes `domli_ai` | Menu entry for that page. |
| `.env.example` | `DEFAULT_LOCALE=nl` | Dutch default. |

## Intentionally not rebranded
- Code identifiers (`Chatwoot` module, `ChatwootApp`, `window.chatwootSDK`, `chatwootSettings`, `X-Chatwoot-*` headers): changing them breaks the widget snippet API and upstream merges.
- Locales other than `en`/`nl`.
- `app.json` (Heroku), GitHub workflows, `CHATWOOT_*` cloud-only config keys (unused).
- `LICENSE` (kept as is; attribution in `NOTICE`).
- Help-center custom-domain instructions mention `chatwoot.help` (upstream hosted service).
