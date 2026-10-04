#!/usr/bin/env bash
# 00:05 IST: daily closing for yesterday, expired Red IDs, then a backup.
set -uo pipefail
cd /opt/shubhora-partner/app
set -a; . ./.env.local; set +a
npx tsx scripts/nightly-closing.ts
/opt/shubhora-partner/bin/backup.sh nightly
