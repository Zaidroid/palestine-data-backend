#!/usr/bin/env bash
# Read-only prod snapshot for the Tier 1 audit. Safe: sqlite backup API via
# python inside the container, output to /tmp only, scp back. Never touches
# session/, keys.db, or .env.
set -euo pipefail
HOST=zaid@100.99.243.75
C=params-alerts-api
OUT="$(dirname "$0")/snapshot"
mkdir -p "$OUT"

for db in checkpoints alerts news; do
  ssh "$HOST" "docker exec $C python -c \"import sqlite3; s=sqlite3.connect('/data/${db}.db'); d=sqlite3.connect('/tmp/${db}_audit.db'); s.backup(d); d.close()\""
  ssh "$HOST" "docker cp $C:/tmp/${db}_audit.db /tmp/${db}_audit.db"
  scp -q "$HOST:/tmp/${db}_audit.db" "$OUT/${db}.db"
  ssh "$HOST" "rm -f /tmp/${db}_audit.db; docker exec $C rm -f /tmp/${db}_audit.db"
  echo "pulled ${db}.db"
done

ssh "$HOST" "docker exec $C cat /data/known_checkpoints.json" > "$OUT/known_checkpoints.prod.json"
ssh "$HOST" "docker exec $C cat /data/city_gateways.json"     > "$OUT/city_gateways.prod.json"
ssh "$HOST" "docker exec $C env" | grep -E "CHANNELS" > "$OUT/prod_env_channels.txt"

curl -sS -m 30 https://wb-alerts.zaidlab.xyz/health                     > "$OUT/health.json"
curl -sS -m 90 "https://wb-alerts.zaidlab.xyz/quality/eval?force=true"   > "$OUT/quality_eval.json"
curl -sS -m 60 "https://wb-alerts.zaidlab.xyz/v2/checkpoints?limit=500"  > "$OUT/v2_checkpoints.json"
curl -sS -m 60 "https://wb-alerts.zaidlab.xyz/checkpoints"               > "$OUT/v1_checkpoints.json"
echo "snapshot complete: $(ls "$OUT" | wc -l) files"
