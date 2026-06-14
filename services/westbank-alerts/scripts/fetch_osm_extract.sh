#!/usr/bin/env bash
# Pre-download the Palestine OSM extract for Valhalla tile building (Phase D).
# Optional — the valhalla container will fetch it on first boot if absent.
set -euo pipefail

DEST="${1:-/opt/stacks/palestine/valhalla_tiles}"
URL="https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf"

mkdir -p "$DEST"
echo "Downloading $URL → $DEST/ (~116 MB)…"
curl -fL --retry 3 -o "$DEST/israel-and-palestine-latest.osm.pbf" "$URL"
echo "Done. Size:"
ls -lh "$DEST/israel-and-palestine-latest.osm.pbf"
echo "Now bring up the valhalla service (see services/westbank-alerts/valhalla/README.md)."
