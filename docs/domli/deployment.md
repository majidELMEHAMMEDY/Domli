# Deployment (single VPS, about 4 GB RAM)

Stack: `docker-compose.production.yml` = rails, sidekiq, postgres (pgvector), redis, bot, caddy.
Image: built by `.github/workflows/publish_domli_image.yml` and pushed to `ghcr.io/<owner>/domli` (Community only: the workflow fails if `enterprise/` exists).

## 1. Server basics (Ubuntu 24.04, EU region)
```bash
# swap (4 GB RAM is tight for rails + sidekiq + postgres)
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf

# firewall: only SSH, HTTP, HTTPS
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable

# docker
curl -fsSL https://get.docker.com | sh
```
Also: SSH keys only (`PasswordAuthentication no`), `unattended-upgrades`, a non-root deploy user.
Docker publishes ports itself and bypasses ufw, so the compose file only publishes 80/443 (Caddy). Postgres and Redis are not published.

## 2. DNS
`app.domli.nl` and `bot.domli.nl` A records -> server IP (the bot host is optional, see Caddyfile).

## 3. Configure
```bash
git clone <your fork> && cd <fork>
cp .env.production.example .env          # fill every empty value
cp domli-bot/.env.example domli-bot/.env # see domli-bot/README.md
cp domli-bot/data/accounts.example.json domli-bot/data/accounts.json   # mounted into the bot container
```
Generate secrets: `openssl rand -hex 64` (SECRET_KEY_BASE), strong passwords for Postgres and Redis.
Encryption keys: `docker compose -f docker-compose.production.yml run --rm rails bundle exec rails db:encryption:init`, paste into `.env`. **Back these up separately: without them stored channel credentials cannot be decrypted.**

## 4. First start
```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <user> --password-stdin   # if the package is private
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml run --rm rails bundle exec rails db:chatwoot_prepare
docker compose -f docker-compose.production.yml up -d
```
Open https://app.domli.nl. The onboarding screen creates the first super admin. `ENABLE_ACCOUNT_SIGNUP=false` keeps public signup closed; clients are created by you (see [new-client.md](new-client.md)).

## 5. HTTPS
Handled by Caddy (`deployment/Caddyfile`), certificates are automatic. Ports 80 and 443 must be reachable.

## 6. Email (SMTP)
Fill the `SMTP_*` values. Use an EU provider and add it to the [subprocessor list](privacy/subprocessors.md). Set SPF, DKIM and DMARC for `domli.nl`. Test from Super Admin or `rails runner "EmailDeliveryTestMailer ..."`.

## 7. Backups (daily) and restore
```bash
# crontab -e   (as the deploy user, from the repo directory)
30 3 * * * cd /opt/domli && scripts/domli/backup.sh /var/backups/domli >> /var/log/domli-backup.log 2>&1
```
Copy `/var/backups/domli` off the server too (e.g. `rclone` to an EU object store). A backup on the same disk is not a backup.

Restore: `scripts/domli/restore.sh /var/backups/domli/db-<stamp>.dump /var/backups/domli/storage-<stamp>.tar.gz`
**Test the restore before relying on it:** restore into a spare VPS or a second compose project with a different `-p` name, log in, open a conversation with an attachment. Record the date of the last successful test here: `____`.

## 8. Monitoring
- Uptime: UptimeRobot / BetterStack on `https://app.domli.nl/health` (HTTP 200).
- Server: `scripts/domli/healthcheck.sh` from cron every 5 minutes, alert by mail on a non-zero exit:
  `*/5 * * * * /opt/domli/scripts/domli/healthcheck.sh || mail -s "Domli alert" you@domli.nl`
  It checks the app URL, disk below 85% and memory below 90%.
- Logs: `docker compose -f docker-compose.production.yml logs -f rails sidekiq bot`.
