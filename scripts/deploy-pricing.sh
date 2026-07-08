#!/bin/bash
# Surgical deploy of the monetization artifacts ONLY — safe alternative to
# deploy-to-main.sh when the local tree is a fresh clone (full rsync
# --delete-after from a fresh clone can delete prod data files; see
# docs/P5-PLAN.md and LIFEOS.md deploy warning, 2026-07-08).
#
# Copies: public/pricing.html, docs/MONETIZATION.md, docs/P5-PLAN.md,
#         docs/invoice-template.md, docs/grants/
# Then re-bakes public/*.html into the api image (same mechanism as
# deploy-to-main.sh) and recreates the api container (~10s blip).
set -euo pipefail

HOST="${DEPLOY_HOST:-zaid@100.99.243.75}"
DEST="${DEPLOY_DEST:-/opt/stacks/palestine}"
cd "$(dirname "$0")/.."

echo "[deploy-pricing] copying files → ${HOST}:${DEST}"
ssh "$HOST" "mkdir -p ${DEST}/docs/grants"
scp -q public/pricing.html "${HOST}:${DEST}/public/"
scp -q docs/MONETIZATION.md docs/P5-PLAN.md docs/invoice-template.md "${HOST}:${DEST}/docs/"
scp -q docs/grants/*.md "${HOST}:${DEST}/docs/grants/"

echo "[deploy-pricing] baking public/*.html into palestine-api:latest and restarting api"
ssh "$HOST" "
    docker rm -f tmp-sc 2>/dev/null;
    docker run --name tmp-sc --entrypoint bash -v ${DEST}:/srcro:ro palestine-api:latest \
        -c 'cp /srcro/public/*.html /app/public/ 2>/dev/null; true' &&
    docker commit --change 'ENTRYPOINT [\"node\",\"src/api/server.js\"]' --change 'CMD []' tmp-sc palestine-api:latest >/dev/null &&
    docker rm tmp-sc >/dev/null &&
    cd ${DEST} && docker compose up -d --no-build --force-recreate api
"

echo "[deploy-pricing] verify"
sleep 10
ssh "$HOST" "curl -s -m 30 localhost:7860/api/v1/health" | head -c 120; echo
curl -s -o /dev/null -w "pricing.html via CF: HTTP %{http_code}\n" https://api.zaidlab.xyz/pricing.html || true
echo "[deploy-pricing] done"
