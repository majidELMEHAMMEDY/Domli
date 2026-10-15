#!/usr/bin/env bash
# Domli backup: Postgres dump + uploaded files. Run from the repo directory on the server.
# Usage: scripts/domli/backup.sh [backup_dir]    (cron example in docs/domli/deployment.md)
set -euo pipefail
COMPOSE="docker compose -f docker-compose.production.yml"
DIR="${1:-/var/backups/domli}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"

$COMPOSE exec -T postgres pg_dump -U postgres -Fc chatwoot_production > "$DIR/db-$STAMP.dump"
$COMPOSE run --rm --no-deps -T --entrypoint tar rails czf - -C /app storage > "$DIR/storage-$STAMP.tar.gz"

# keep 14 days
find "$DIR" -name 'db-*.dump' -mtime +14 -delete
find "$DIR" -name 'storage-*.tar.gz' -mtime +14 -delete
echo "Backup written to $DIR ($STAMP)"
