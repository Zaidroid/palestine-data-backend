# Runbook

Operational procedures for the Palestine Data Backend (api + alerts services).

## 1. Rotate `API_SECRET_KEY` (FastAPI alerts service)

The alerts service refuses to boot if `API_SECRET_KEY` is unset, shorter than 16 chars, or matches a known dev default.

```bash
# Generate a new secret
python3 -c "import secrets; print(secrets.token_hex(32))"

# On the live server
ssh admin@192.168.0.118
cd ~/palestine-data-backend
sed -i.bak "s|^API_SECRET_KEY=.*|API_SECRET_KEY=<new-secret>|" services/westbank-alerts/.env
docker compose up -d --force-recreate alerts
docker compose logs --tail=20 alerts   # confirm "ready" not "FATAL"
```

## 2. Issue a customer API key

```bash
# Local dev (uses ./data/keys.db)
KEYS_DB_PATH=./data/keys.db node scripts/manage-keys.js issue customer@example.com journalist

# Live server (uses /app/data/keys.db inside the container; same file mounted from ./data)
ssh admin@192.168.0.118
cd ~/palestine-data-backend
docker compose exec api node scripts/manage-keys.js issue customer@example.com ngo
```

Tiers: `free | journalist | ngo | enterprise`. The raw key is printed once — store it then deliver to the customer over a secure channel.

## 3. Backup `alerts.db`

Daily online snapshot via `scripts/backup-alerts-db.sh`. Local retention defaults to 30 days; remote retention is managed by the bucket policy.

```bash
# Manual run on the server
ssh admin@192.168.0.118
cd ~/palestine-data-backend
BACKUP_REMOTE=b2:palestine-backups/alerts ./scripts/backup-alerts-db.sh

# Cron (nightly 03:15 UTC)
crontab -l    # confirm presence; if missing:
( crontab -l 2>/dev/null; echo '15 3 * * * cd ~/palestine-data-backend && BACKUP_REMOTE=b2:palestine-backups/alerts ./scripts/backup-alerts-db.sh >> ~/backup.log 2>&1' ) | crontab -
```

Required setup once:
1. `apt install rclone sqlite3`
2. `rclone config` → add a Backblaze B2 remote named `b2`.
3. Create bucket `palestine-backups` in B2 console; set lifecycle to keep 90 days.

## 4. Restore `alerts.db` from snapshot

```bash
# 1. Stop the alerts container so writes pause
docker compose stop alerts

# 2. Pull a snapshot (local or remote)
ls services/westbank-alerts/data/backups/ | tail            # local
rclone copy b2:palestine-backups/alerts/alerts-2026-04-18T03-15-00Z.db ./services/westbank-alerts/data/

# 3. Swap files
cp services/westbank-alerts/data/alerts.db services/westbank-alerts/data/alerts.db.before-restore
cp services/westbank-alerts/data/alerts-2026-04-18T03-15-00Z.db services/westbank-alerts/data/alerts.db

# 4. Integrity-check + restart
sqlite3 services/westbank-alerts/data/alerts.db 'PRAGMA integrity_check;'   # expect: ok
docker compose start alerts
docker compose logs --tail=50 alerts
```

## 5. Tail structured logs

Both services emit one JSON object per line. Use `jq` to slice:

```bash
docker compose logs --tail=200 -f api    | jq 'select(.level=="error")'
docker compose logs --tail=200 -f alerts | jq 'select(.level=="error" or .level=="warning")'
```

Filter by request ID (Node API echoes `x-request-id` on every response):

```bash
docker compose logs --since=10m api | jq 'select(.req.id=="<id-from-curl-headers>")'
```

## 6. Rebuild after deploy

```bash
ssh admin@192.168.0.118
cd ~/palestine-data-backend
# (rsync from local first)
docker compose up -d --build
docker compose ps           # confirm both healthy
curl -fsS http://localhost:7860/api/v1/health
curl -fsS http://localhost:8080/health
```
