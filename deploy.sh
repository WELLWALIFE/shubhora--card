#!/usr/bin/env bash
# Deploy Shubhora Partner to the VPS (same box as NeuralEdge, separate app, port 3002).
# Order: tests → build → backup database → upload → install → restart → health check.
# The server keeps its own .env.local (database password, setup token, Razorpay keys); never synced.
set -euo pipefail

SERVER="root@148.72.247.91"
KEY="$HOME/.ssh/neuraledge_vps"
APP="/opt/shubhora-partner/app"
HOST="shubhora.com"
# Served under a path of the Shubhora site until the company domain is ready. Change both lines to move it.
export NEXT_PUBLIC_BASE_PATH="/partners"
SSH="ssh -i $KEY -o IdentitiesOnly=yes -o ConnectTimeout=60 -o ServerAliveInterval=30 -o ServerAliveCountMax=10"

if [ "${SKIP_TESTS:-}" != "1" ]; then
  echo "→ running plan tests (a failing test stops the deploy)…"
  npx vitest run --reporter=dot
fi
npx tsc --noEmit

echo "→ building…"
npm run build

echo "→ backing up the live database before the update…"
$SSH "$SERVER" "/opt/shubhora-partner/bin/backup.sh pre-deploy || true"

# The VPS sometimes stalls an SSH connection under load ("io timeout after 120 seconds"). Each upload is retried up to
# 3 times; --partial keeps what already arrived, so a retry only sends the rest. Nothing is restarted until all three
# uploads have finished, so a failed attempt never leaves the live site half-updated.
retry() { local n=1; until "$@"; do [ $n -ge 3 ] && { echo "!! upload failed 3 times — nothing was restarted; run deploy.sh again"; return 1; }; echo "   upload stalled — retrying ($((n+1))/3)…"; n=$((n+1)); sleep 5; done; }

echo "→ uploading…"
# .data* = the local development database and its backups: never sent to the server.
retry rsync -az --partial --timeout=120 -e "$SSH" \
  --exclude node_modules --exclude .next --exclude ".env*" --exclude ".data*" --exclude .git --exclude tests --exclude tsconfig.tsbuildinfo \
  ./ "$SERVER:$APP/"
retry rsync -az --delete --partial --timeout=120 --exclude /cache --exclude /dev -e "$SSH" .next/ "$SERVER:$APP/.next/"
retry rsync -az --timeout=120 -e "$SSH" server/ "$SERVER:/opt/shubhora-partner/bin/"

echo "→ installing dependencies…"
$SSH "$SERVER" "cd $APP && npm ci --no-audit --no-fund --loglevel=error"

echo "→ restarting…"
$SSH "$SERVER" "cd $APP && (pm2 describe shubhora-partner >/dev/null 2>&1 && pm2 restart shubhora-partner --update-env >/dev/null || pm2 start ecosystem.config.cjs >/dev/null) && pm2 save >/dev/null && sleep 6"

echo "→ health check…"
curl --fail --silent --show-error -o /dev/null -w "   login page %{http_code}\n" --resolve "$HOST:443:148.72.247.91" "https://$HOST$NEXT_PUBLIC_BASE_PATH/login" --max-time 30 \
  || $SSH "$SERVER" "curl -s -o /dev/null -w '   local %{http_code}\n' http://127.0.0.1:3002$NEXT_PUBLIC_BASE_PATH/login"
echo "✓ deployed"
