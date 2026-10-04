#!/usr/bin/env bash
# Compressed PostgreSQL backup of the partner database (and, nightly, the uploaded files).
# Keeps 14 nightly and 10 pre-deploy copies.   backup.sh [nightly|pre-deploy]
set -euo pipefail
KIND="${1:-nightly}"
DIR=/var/backups/shubhora-partner
URL=$(grep ^DATABASE_URL= /opt/shubhora-partner/app/.env.local | cut -d= -f2-)
STAMP=$(date -u +%Y%m%d-%H%M%S)
umask 077
pg_dump --format=custom --no-owner "$URL" > "$DIR/$KIND-$STAMP.dump"
pg_restore --list "$DIR/$KIND-$STAMP.dump" > /dev/null   # proves the file is readable
KEEP=14; [ "$KIND" = "pre-deploy" ] && KEEP=10
ls -1t "$DIR"/$KIND-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup ok: $DIR/$KIND-$STAMP.dump ($(du -h "$DIR/$KIND-$STAMP.dump" | cut -f1))"
if [ "$KIND" = "nightly" ] && [ -d /opt/shubhora-partner/uploads ]; then
  tar -czf "$DIR/uploads-$STAMP.tgz" -C /opt/shubhora-partner uploads
  ls -1t "$DIR"/uploads-*.tgz | tail -n +8 | xargs -r rm -f
  echo "uploads ok: $DIR/uploads-$STAMP.tgz ($(du -h "$DIR/uploads-$STAMP.tgz" | cut -f1))"
fi
