#!/usr/bin/env bash
# Exit non-zero (for cron / uptime monitors) when the app, disk or memory is unhealthy.
set -u
URL="${1:-https://app.domli.nl/health}"
fail=0
curl -fsS --max-time 10 "$URL" >/dev/null || { echo "APP DOWN: $URL"; fail=1; }
disk=$(df / --output=pcent | tail -1 | tr -dc '0-9'); [ "$disk" -lt 85 ] || { echo "DISK ${disk}%"; fail=1; }
mem=$(free | awk '/Mem:/ {printf "%d", $3/$2*100}'); [ "$mem" -lt 90 ] || { echo "MEMORY ${mem}%"; fail=1; }
exit $fail
