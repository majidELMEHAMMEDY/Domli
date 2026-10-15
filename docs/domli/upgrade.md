# Upgrading (merging upstream Chatwoot)

Domli is a fork of Chatwoot Community. All our changes to upstream files are listed in [DOMLI_CHANGES.md](../../DOMLI_CHANGES.md).

## Merge upstream
```bash
git remote add upstream https://github.com/chatwoot/chatwoot.git   # once
git fetch upstream --tags
git checkout -b upgrade/<version>
git merge <upstream tag, e.g. v4.19.0>
```
Expected conflicts:
- `enterprise/**` modified upstream: resolve with `git rm -r enterprise spec/enterprise` (keep it deleted).
- Locale files (`en`/`nl` JSON, `en.yml`, `nl.yml`): re-apply "Chatwoot" -> "Domli" (see script below).
- Files listed in DOMLI_CHANGES.md: keep our change, adopt upstream's other edits.

Re-run the string rebrand after the merge (idempotent):
```bash
python3 - <<'PY'
import re,glob
pat=re.compile(r'(?<![-\w/.@])Chatwoot(?![-\w])')
files=glob.glob('app/javascript/dashboard/i18n/locale/en/*.json')+glob.glob('app/javascript/dashboard/i18n/locale/nl/*.json')+['app/javascript/widget/i18n/locale/en.json','app/javascript/survey/i18n/locale/en.json','config/locales/en.yml']
for f in files:
    s=open(f).read(); t=pat.sub('Domli',s)
    if t!=s: open(f,'w').write(t)
PY
git grep -n "enterprise?" -- lib/chatwoot_hub.rb   # confirm the hub stubs are still in place
```
Then check: `ls enterprise` must fail, `lib/chatwoot_hub.rb` still has the Domli no-op stubs, update DOMLI_CHANGES.md, and read upstream's release notes for new env vars.

## Build and deploy
1. Push the branch; the GitHub Action builds `ghcr.io/<owner>/domli:<tag>`.
2. **Take a backup first**: `scripts/domli/backup.sh`.
3. On the server:
```bash
export DOMLI_IMAGE=ghcr.io/<owner>/domli:<tag>     # or set it in .env
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml run --rm rails bundle exec rails db:chatwoot_prepare   # migrations
docker compose -f docker-compose.production.yml up -d
```

## Roll back
Code only (no migrations in the release): set `DOMLI_IMAGE` to the previous tag, `pull`, `up -d`.
With migrations: restore the pre-upgrade backup with `scripts/domli/restore.sh` AND set the previous image tag. Do not run `db:rollback` on production unless the migration is known to be reversible.
Always keep the last 3 image tags; do not delete old tags from GHCR.
