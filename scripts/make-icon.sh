#!/usr/bin/env bash
# Regenerates build/icon.icns (and a 1024 px build/icon.png) from build/icon.svg.
# Needs macOS (sips, iconutil) and the project's Electron (npm install).
set -euo pipefail
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
master="$work/master.png"
iconset="$work/icon.iconset"

npx --no-install electron scripts/render-icon.cjs build/icon.svg "$master"
cp "$master" build/icon.png

mkdir "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$master" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$master" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o build/icon.icns
echo "wrote build/icon.icns ($(wc -c < build/icon.icns | tr -d ' ') bytes)"
