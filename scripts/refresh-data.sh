#!/bin/bash
# Palestine Data Backend — daily refresh pipeline.
#
# Mission: every category is regularly updated. This script runs each
# fetcher, logs failures, then re-runs the unified pipeline + databank
# backfills + manifest/quality + a pinned snapshot.
#
# Designed to be cron-safe: never `set -e` (a single broken upstream
# shouldn't skip the rest); always exits 0 so cron doesn't suppress
# subsequent runs.
#
# Cron entry (recommended): 15 4 * * *  /home/admin/palestine-data-backend/scripts/refresh-data.sh

cd "$(dirname "$0")/.." || exit 1
LOG=public/data/refresh-$(date -u +%Y-%m-%d).log
mkdir -p public/data

started_at=$(date -u +%s)
echo "=== refresh-data started $(date -u -Iseconds) ===" | tee "$LOG"

run() {
    local label="$1"; shift
    local t0=$(date -u +%s)
    if "$@" >>"$LOG" 2>&1; then
        echo "  OK ${label} ($(( $(date -u +%s) - t0 ))s)" | tee -a "$LOG"
    else
        local rc=$?
        echo "  FAIL ${label} (rc=${rc}, $(( $(date -u +%s) - t0 ))s)" | tee -a "$LOG"
    fi
}

# Step 1: Fetch fresh data from each source
echo "[step 1] fetching upstream sources" | tee -a "$LOG"
run "gaza-daily"      node scripts/fetch-gaza-daily.js
run "prisoners"       node scripts/fetch-prisoners.js
run "unhcr-refugees"  node scripts/sources/unhcr.js
run "unfts-funding"   node scripts/sources/unfts.js
run "infrastructure"  node scripts/fetch-infrastructure-data.js
run "rss-news"        node scripts/fetch-rss-feeds.js
run "culture"         node scripts/fetch-culture-data.js
run "land"            node scripts/fetch-land-data.js
run "water"           node scripts/fetch-water-data.js
run "pcbs"            node scripts/fetch-pcbs-data.js
run "worldbank"       node scripts/fetch-worldbank-data.js
run "who"             node scripts/fetch-who-data.js
run "hdx"             node scripts/fetch-hdx-ckan-data.js
run "goodshepherd"    node scripts/fetch-goodshepherd-data.js
run "historical"      node scripts/fetch-historical-data.js

# Step 2: Unified pipeline (transforms raw -> /unified/ categories)
echo "[step 2] unified pipeline" | tee -a "$LOG"
run "populate-unified" node scripts/populate-unified-data.js

# Step 3: Manifests + quality snapshot
echo "[step 3] manifests + quality" | tee -a "$LOG"
run "manifest"        node scripts/generate-unified-manifest.js
run "quality"         node scripts/generate-quality-snapshot.js
run "search-index"    node scripts/generate-search-index.js

# Step 4: Databank backfills
echo "[step 4] databank backfills" | tee -a "$LOG"
run "databank-martyrs"   python3 scripts/backfill-people-killed-from-martyrs.py
run "databank-gaza"      python3 scripts/backfill-databank-from-gaza-daily.py
run "databank-prisoners" python3 scripts/backfill-databank-from-prisoners.py

# Step 5: Pinned daily snapshot for ?as_of= queries
echo "[step 5] daily snapshot" | tee -a "$LOG"
run "write-snapshot" node scripts/write-snapshot.js

# Step 6: Restart api container so apicache picks up fresh data
echo "[step 6] restart api" | tee -a "$LOG"
run "docker-restart-api" docker compose restart api

elapsed=$(( $(date -u +%s) - started_at ))
echo "=== refresh-data done in ${elapsed}s ===" | tee -a "$LOG"
exit 0
