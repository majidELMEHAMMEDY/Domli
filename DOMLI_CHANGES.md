# Domli changes to upstream Chatwoot files

Base: Chatwoot 4.18.0 (commit a0dfab928). Keep this list current so upstream merges stay easy.
Domli-only folders (no merge conflicts): `branding/`, `docs/domli/`, `domli-bot/`, `NOTICE`, `DOMLI_CHANGES.md`.

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
| `.env.example` | `DEFAULT_LOCALE=nl` | Dutch default. |

## Intentionally not rebranded
- Code identifiers (`Chatwoot` module, `ChatwootApp`, `window.chatwootSDK`, `chatwootSettings`, `X-Chatwoot-*` headers): changing them breaks the widget snippet API and upstream merges.
- Locales other than `en`/`nl`.
- `app.json` (Heroku), GitHub workflows, `CHATWOOT_*` cloud-only config keys (unused).
- `LICENSE` (kept as is; attribution in `NOTICE`).
- Help-center custom-domain instructions mention `chatwoot.help` (upstream hosted service).
