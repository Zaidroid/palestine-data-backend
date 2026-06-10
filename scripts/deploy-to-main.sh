#!/bin/bash
# Deploy the repo + generated data to the homelab "main" server and refresh
# the api image's baked src/scripts. Encapsulated here because ad-hoc rsync
# once clobbered the production key store — the excludes below are the
# contract for what NEVER syncs:
#   - runtime SQLite (customer keys, alerts/checkpoints DBs)
#   - the alerts service's .env and Telegram session
set -euo pipefail

HOST="${DEPLOY_HOST:-zaid@100.99.243.75}"
DEST="${DEPLOY_DEST:-/opt/stacks/palestine}"
cd "$(dirname "$0")/.."

echo "[deploy] rsync → ${HOST}:${DEST}"
rsync -a --delete-after \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='.venv*' \
    --exclude='data/keys.db*' \
    --exclude='services/westbank-alerts/.env' \
    --exclude='services/westbank-alerts/session' \
    --exclude='services/westbank-alerts/data/alerts.db*' \
    --exclude='services/westbank-alerts/data/checkpoints.db*' \
    ./ "${HOST}:${DEST}/"

echo "[deploy] bake src+scripts into palestine-api:latest and restart api"
ssh "$HOST" "
    docker rm -f tmp-sc 2>/dev/null;
    docker run --name tmp-sc --entrypoint bash -v ${DEST}:/srcro:ro palestine-api:latest \
        -c 'rm -rf /app/src /app/scripts && cp -r /srcro/src /app/src && cp -r /srcro/scripts /app/scripts && cp /srcro/public/*.html /srcro/public/*.json /app/public/ 2>/dev/null; true' &&
    docker commit --change 'ENTRYPOINT [\"node\",\"src/api/server.js\"]' --change 'CMD []' tmp-sc palestine-api:latest >/dev/null &&
    docker rm tmp-sc >/dev/null &&
    cd ${DEST} && docker compose up -d --no-build --force-recreate api
"

echo "[deploy] verify"
sleep 10
ssh "$HOST" "curl -s -m 30 localhost:7860/api/v1/health" | head -c 120
echo
echo "[deploy] done"
