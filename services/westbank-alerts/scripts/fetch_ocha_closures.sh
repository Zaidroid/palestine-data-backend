#!/usr/bin/env bash
# Fetch the CURRENT OCHA oPt West Bank closure/obstacle layers (machine-readable GeoJSON).
# Source: UN OCHA ArcGIS server gis.unocha.org (anonymous-public "Hosted" folder, native WGS84).
# Verified 2026-06-15. NOTE: gis.ochaopt.org is dead — use gis.unocha.org.
#
# These replace the stale 2022 closures the router shipped with. The ~925 OCHA headline =
# 811 point obstacles (ClosurePoints_811) + ~114 linear closures (only the stale 2022
# linear set is public — current linear geometry is not served openly).
set -euo pipefail

DEST="${1:-data/ocha/2025}"
BASE="https://gis.unocha.org/server/rest/services/Hosted"
mkdir -p "$DEST"

# service : output filename : note
LAYERS=(
  "ClosurePoints_811:closurepoints_811.geojson:811 point obstacles, Dec 2025 (PRIMARY)"
  "BarrierGates2025_view:barrier_gates_2025.geojson:74 separation-barrier gates, 2025"
  "GreenLine_Checkpoint_Nov2025:greenline_checkpoints_nov2025.geojson:10 WB<->Israel crossings, Nov 2025"
  "Roads_Accessibility_20250818:roads_accessibility_2025.geojson:road accessibility lines, Aug 2025"
)

for entry in "${LAYERS[@]}"; do
  svc="${entry%%:*}"; rest="${entry#*:}"; out="${rest%%:*}"; note="${rest#*:}"
  url="$BASE/$svc/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson"
  echo "Fetching $svc  ($note)"
  curl -fL --retry 3 -o "$DEST/$out" "$url"
  cnt=$(python3 -c "import json,sys; print(len(json.load(open('$DEST/$out'))['features']))")
  echo "  -> $DEST/$out  ($cnt features)"
done

echo "Done. Build the restriction layer with: python3 scripts/build_restrictions_from_ocha.py"
