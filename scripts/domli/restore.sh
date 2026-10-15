#!/usr/bin/env bash
# Domli restore. DESTRUCTIVE: replaces the current database and uploaded files.
# Usage: scripts/domli/restore.sh <db-dump> <storage-tarball>
set -euo pipefail
[ $# -eq 2 ] || { echo "Usage: $0 <db-xxx.dump> <storage-xxx.tar.gz>"; exit 1; }
COMPOSE="docker compose -f docker-compose.production.yml"
read -r -p "This REPLACES the current database and files. Type 'restore' to continue: " ok
[ "$ok" = "restore" ] || exit 1

$COMPOSE stop rails sidekiq
$COMPOSE exec -T postgres dropdb -U postgres --if-exists chatwoot_production
$COMPOSE exec -T postgres createdb -U postgres chatwoot_production
$COMPOSE exec -T postgres pg_restore -U postgres -d chatwoot_production --no-owner < "$1"
$COMPOSE run --rm --no-deps -T --entrypoint sh rails -c 'rm -rf /app/storage/* && tar xzf - -C /app' < "$2"
$COMPOSE up -d
echo "Restore finished. Check https://app.domli.nl"
