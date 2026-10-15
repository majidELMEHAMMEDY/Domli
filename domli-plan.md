# Domli: Project Plan (Chatwoot Community fork)

You are working inside my fork of Chatwoot. Goal: turn it into **Domli** (domli.nl), a hosted, Dutch-first customer inbox for small businesses, built only on the **Community edition** (MIT). Read this whole file first, inspect the repo, then propose your plan before making large changes.

## 1. Product summary

Domli gives small businesses one inbox for:
- Website contact/chat button (the Chatwoot web widget)
- Email
- WhatsApp (and later Instagram/Facebook)
- Optional AI support (Claude API) that answers common questions and drafts replies
- Link to the client's appointment system (first target: OnlineAfspraken.nl)

Target customers: small businesses in the Netherlands (salons, garages, driving schools, private clinics, small agencies). Dutch is the default language. I host it for them; they pay a monthly fee that includes hosting, updates, backups and basic support.

I am a full-stack developer (React, Node.js, PHP/Laravel, .NET). I am not a Ruby/Rails expert, so explain Rails-specific changes briefly and keep them minimal.

## 2. Hard rules

1. **Community edition only.** Remove or neutralize everything under `enterprise/` and anything that depends on it. Never copy enterprise code into other folders.
2. **Keep the license.** Keep the root `LICENSE` file (MIT) and Chatwoot's copyright notice. Add a `NOTICE`/credits entry such as "Domli is based on Chatwoot Community Edition (MIT)". Do not delete or alter license text.
3. **Rebrand, but do not use Chatwoot's name or logo as ours.** Replace user-facing brand names, logos and links with Domli. Internal code identifiers, module names and database names should stay as they are unless a change is safe and clearly needed.
4. **Minimal diffs.** I want to keep merging upstream security fixes. Prefer configuration, i18n files and asset replacement over rewriting core code. Group customizations so they are easy to find (see section 8).
5. **No destructive actions without asking.** Do not delete data, drop databases, force-push, or touch production config. Ask before running anything that could lose data.
6. **No secrets in the repo.** Use `.env` files that are git-ignored, and provide `.env.example` only.
7. **Verify instead of guessing.** Chatwoot's file layout and config names change between versions. Check the actual repo before relying on any path or setting mentioned in this plan.

## 3. Phase 1: Audit (no changes yet)

- Report the Chatwoot version/commit this fork is based on.
- List everything related to enterprise code: the `enterprise/` directory, `ChatwootApp.enterprise?` checks, `prepend_mod_with` / `include_mod_with` hooks, enterprise-only routes, models, jobs, migrations, frontend flags and feature gates, plan/billing/upgrade prompts and license-activation UI.
- List all places that show the Chatwoot brand to users: web dashboard, login page, emails, widget ("Powered by" badge), help links, super admin, favicon and manifest, API docs links, default installation config.
- List the locale files and how Dutch (`nl`) is currently covered.
- Output a short written audit with file paths. Wait for my confirmation before Phase 2.

## 4. Phase 2: Remove enterprise/premium code

- Remove the `enterprise/` directory and everything that requires it. Make the app run cleanly as a Community build.
- Remove or hide UI for premium-only features and upgrade/billing prompts, so users never see locked or paid features.
- Make sure the Community build has no references to license checks, plan limits or enterprise-only gems that break boot.
- Check that migrations still run on a fresh database.
- Confirm by booting the app locally (Docker) and running the test suite for the touched areas. List what you changed and anything you left on purpose.

## 5. Phase 3: Rebrand to Domli

Use the existing installation/branding configuration where possible (look for `config/installation_config.yml` and installation-config settings in the super admin such as installation name, logo, brand name and URLs, and verify the names in this version).

- Product name: **Domli**. Domain: **domli.nl**. App URL placeholder: `https://app.domli.nl`.
- Replace logos, favicon, touch icons, web manifest, Open Graph images. I will provide the logo files in `branding/`; use placeholders until then and tell me the required sizes.
- Brand colors: use placeholders in one central place (CSS variables / theme config) so I can change them later.
- Replace the widget "Powered by" badge so it does not advertise Chatwoot. It may link to domli.nl.
- Replace Chatwoot name in email templates, notification texts, error pages, onboarding screens, help/support links and page titles.
- Terms and privacy links must point to domli.nl pages (placeholders).
- Set the default locale to Dutch (`nl`), and fill in missing or low-quality Dutch strings in the main user flows (login, inbox, conversation view, settings, widget, emails). English stays as a fallback.
- Keep a short list of anything you intentionally did not rebrand, with reasons.

## 6. Phase 4: Customize for Domli's needs

Do these as separate, reviewable changes. Prefer using Chatwoot's existing extension points (webhooks, agent bots, API, custom attributes, canned responses) over modifying core code.

1. **Simplified onboarding for small businesses.** A short setup path: create account, add website widget (copy-paste snippet), connect email, connect WhatsApp, invite team. Hide or de-emphasize advanced settings that small businesses do not need.
2. **Website contact button.** Make the widget easy to install and style (Dutch labels, business hours, away message, pre-chat form option). Provide a one-line embed snippet in the dashboard.
3. **WhatsApp.** Support the WhatsApp Cloud API channel. Document the setup steps in Dutch. The client's own Meta billing is used for message fees.
4. **AI assistant (Claude API).** Build a separate small service (not inside Rails core) that acts as a Chatwoot agent bot via webhook:
   - Receives message events, looks up the business's FAQ/knowledge, and either drafts a suggested reply for an agent to approve or replies automatically for simple FAQs (configurable per account, default: draft only).
   - Hands off to a human on anything about prices, complaints, medical topics or when unsure.
   - Per-account monthly usage cap and token logging. API key stays in server environment variables.
   - Must be easy to turn off per account.
5. **Appointments (OnlineAfspraken.nl first).** In the same bot/integration service, add a module that can check availability and create appointments through the OnlineAfspraken API, or at minimum send the client's booking link. Design it as an adapter so other booking systems can be added later. Check the OnlineAfspraken API documentation for what is actually supported before building.
6. **Multi-tenant safety.** Confirm that each client account is isolated (agents, inboxes, contacts, conversations). Document how I create a new client account and invite its owner.

## 7. Phase 5: Build, deploy and operate

- Create a production `Dockerfile`/compose setup based on the repo, building a **Community** image only, and a GitHub Actions workflow that builds and pushes it to GitHub Container Registry.
- Target server: a small VPS (about 4 GB RAM to start). Provide a `docker-compose.production.yml` with the app, worker, Postgres and Redis, using volumes for persistent data. Document: HTTPS via Caddy or Nginx, SMTP/email sending, swap setup, firewall basics.
- Provide backup scripts (Postgres dump + uploaded files) with restore instructions, and a tested restore procedure.
- Provide an upgrade guide: how to merge upstream Chatwoot changes into this fork, rebuild, run migrations and roll back.
- Provide a health-check and basic monitoring suggestion (uptime check, disk and memory alerts).

## 8. Repo organization

- Put Domli-specific documentation in `docs/domli/`.
- Put the AI/appointments bot service in its own top-level folder, e.g. `domli-bot/`, with its own README and `.env.example`.
- Put brand assets in `branding/`.
- Keep a `DOMLI_CHANGES.md` file that lists every customization to upstream files (path, reason), so merges from upstream are easier.
- Use small commits with clear messages, one topic per commit.

## 9. Privacy and compliance notes

- Clients are mostly Dutch small businesses, so data is stored in the EU and the product must be usable under the AVG/GDPR: provide a draft data processing agreement (verwerkersovereenkomst) template, privacy policy outline and subprocessor list (hosting provider, AI provider, email provider).
- Do not target healthcare/GP practices in the first version. Add a note in the docs that medical data and automatic AI answers about health topics are out of scope.
- The AI service should minimize the data it sends to the AI provider and must not log message contents longer than needed.

## 10. Acceptance checklist

- [ ] App builds and boots as a Community-only image; no enterprise code remains
- [ ] Fresh database migrations succeed; existing tests for touched areas pass
- [ ] No visible "Chatwoot" branding in dashboard, emails, widget, favicon or page titles (except the license/credits notice)
- [ ] LICENSE and attribution to Chatwoot are intact
- [ ] Default language is Dutch, with English fallback
- [ ] Widget installs from a single snippet and works on a plain HTML page
- [ ] WhatsApp test number connected and messages flow both ways
- [ ] AI bot answers a sample FAQ, hands off correctly, and can be disabled per account
- [ ] Appointment link/booking works against a test OnlineAfspraken account (or documented as pending if the API does not allow it)
- [ ] Two test client accounts cannot see each other's data
- [ ] Backup and restore tested; upgrade guide written
- [ ] `DOMLI_CHANGES.md` is up to date

## 11. How I want you to work

1. Start with Phase 1 and give me the audit before changing anything.
2. After each phase, summarize what changed, what you tested, and what is still open.
3. Ask me short, specific questions when a decision is mine (colors, copy, pricing, which feature to cut), and otherwise choose the simplest option and say what you chose.
4. If something in this plan does not match the repo, tell me instead of guessing.
