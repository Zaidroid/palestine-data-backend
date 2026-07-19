#!/bin/bash
# Safe re-bake of palestine-api:latest from the server's ALREADY-git-synced tree.
#
# Use when /opt/stacks/palestine on main is already at the target commit — e.g.
# right after the alerts deploy.sh ran `git reset --hard origin/main` — and you
# only need to refresh the Node api image's baked src/scripts/html. This does NOT
# rsync, so it CANNOT trigger the deploy-to-main.sh data-wipe hazard (a full
# rsync --delete-after from a checkout lacking the gitignored public/data can
# delete prod databank files; see docs/P5-PLAN.md deploy warning).
#
# Same bake mechanism as deploy-to-main.sh (docker run + commit), reading from
# the server tree instead of the local one. keys.db / public/data are volume
# mounts and are never touched.
set -euo pipefail

HOST="${DEPLOY_HOST:-zaid@100.99.243.75}"
# SRC = the palestine-data-backend git clone that deploy.sh resets to origin/main
# (this holds the updated Node src/). STACK = the compose dir. They are DIFFERENT
# directories on main — deploy.sh syncs only the alerts context from SRC into
# STACK, so the api image must be baked straight from SRC.
SRC="${DEPLOY_SRC:-/opt/stacks/palestine-data-backend}"
STACK="${DEPLOY_STACK:-/opt/stacks/palestine}"

echo "[bake-api] source clone at:"
# Informational only — never let it block the bake. -c safe.directory='*'
# sidesteps the dubious-ownership check without touching global git config.
ssh "$HOST" "git -c safe.directory='*' -C ${SRC} log --oneline -1 2>/dev/null || echo '(git check skipped; baking on-disk tree)'"

echo "[bake-api] baking src+scripts+html from ${SRC} into palestine-api:latest and restarting api"
ssh "$HOST" "
    docker rm -f tmp-sc 2>/dev/null;
    docker run --name tmp-sc --entrypoint bash -v ${SRC}:/srcro:ro palestine-api:latest \
        -c 'rm -rf /app/src /app/scripts && cp -r /srcro/src /app/src && cp -r /srcro/scripts /app/scripts && cp /srcro/public/*.html /srcro/public/*.json /app/public/ 2>/dev/null; true' &&
    docker commit --change 'ENTRYPOINT [\"node\",\"src/api/server.js\"]' --change 'CMD []' tmp-sc palestine-api:latest >/dev/null &&
    docker rm tmp-sc >/dev/null &&
    cd ${STACK} && docker compose up -d --no-build --force-recreate api
"

echo "[bake-api] verify"
sleep 10
ssh "$HOST" "curl -s -m 30 localhost:7860/api/v1/health" | head -c 160; echo
curl -s -o /dev/null -w "access-request route via CF: HTTP %{http_code}  (400=live+validating, 404=not deployed)\n" \
    -X POST https://api.zaidlab.xyz/api/v1/access-request \
    -H 'Content-Type: application/json' -d '{"email":"invalid"}' || true
echo "[bake-api] done"
