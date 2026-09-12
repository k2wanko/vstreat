#!/usr/bin/env bash
# Costs nothing, takes no time, and paints nothing worth looking at.
#
# Use it to prove the plumbing before spending a generation: if every stage
# produces a file with this, later failures are about content, not wiring.
# It cannot stand in for the aerial photograph - a gradient traces into no
# roads and no buildings - so the free run starts from a town.geojson that
# already exists.
set -euo pipefail
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    *)     shift ;;
  esac
done
[ -n "$out" ] || { echo "mock adapter: --out is required" >&2; exit 2; }
mkdir -p "$(dirname "$out")"
exec bun "$(dirname "$0")/../scripts/lib/mock-image.ts" "$out"
