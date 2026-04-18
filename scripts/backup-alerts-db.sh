#!/usr/bin/env bash
# Online backup of services/westbank-alerts/data/alerts.db with optional remote upload.
#
# Env:
#   ALERTS_DB_PATH   default ./services/westbank-alerts/data/alerts.db
#   BACKUP_DIR       default ./services/westbank-alerts/data/backups (local retention)
#   BACKUP_REMOTE    optional rclone remote spec (e.g. "b2:palestine-backups/alerts").
#                    If set, the snapshot is uploaded with `rclone copy` after creation.
#   RETENTION_DAYS   default 30 (local; remote retention managed by the bucket policy)
#
# Cron example (nightly at 03:15):
#   15 3 * * * cd ~/palestine-data-backend && BACKUP_REMOTE=b2:palestine-backups/alerts \
#              ./scripts/backup-alerts-db.sh >> ~/backup.log 2>&1

set -euo pipefail

ALERTS_DB_PATH="${ALERTS_DB_PATH:-./services/westbank-alerts/data/alerts.db}"
BACKUP_DIR="${BACKUP_DIR:-./services/westbank-alerts/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

ts="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
out="${BACKUP_DIR}/alerts-${ts}.db"

if [ ! -f "$ALERTS_DB_PATH" ]; then
  echo "FATAL: alerts.db not found at $ALERTS_DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%FT%TZ)] backup_start db=$ALERTS_DB_PATH out=$out"
# .backup is the only safe way to snapshot a live, write-active SQLite DB.
sqlite3 "$ALERTS_DB_PATH" ".backup '$out'"

# Quick integrity check on the snapshot itself.
result="$(sqlite3 "$out" 'PRAGMA integrity_check;' | head -n 1)"
if [ "$result" != "ok" ]; then
  echo "FATAL: integrity_check failed on $out: $result" >&2
  rm -f "$out"
  exit 2
fi

bytes="$(wc -c < "$out" | tr -d ' ')"
echo "[$(date -u +%FT%TZ)] backup_ok bytes=$bytes path=$out"

# Optional: ship to remote
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "FATAL: BACKUP_REMOTE set but rclone not installed" >&2
    exit 3
  fi
  echo "[$(date -u +%FT%TZ)] remote_upload_start dest=$BACKUP_REMOTE"
  rclone copy --quiet "$out" "$BACKUP_REMOTE/"
  echo "[$(date -u +%FT%TZ)] remote_upload_ok"
fi

# Local retention
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'alerts-*.db' -mtime "+$RETENTION_DAYS" -print -delete \
  | sed 's/^/[retention] removed /'

echo "[$(date -u +%FT%TZ)] backup_done"
