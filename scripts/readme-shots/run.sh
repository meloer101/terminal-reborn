#!/bin/bash
# Regenerates the README images in docs/assets/readme/: the real app over demo repos (app.spec.ts) and sections of the
# website (site.mjs). Needs macOS, Google Chrome and a signed-in `claude` for the hero.
#   npm run readme:shots
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=docs/assets/readme
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

bash scripts/readme-shots/make-demo.sh "$WORK/demo"
npx electron-vite build
DEMO_DIR="$WORK/demo" SHOTS_DIR="$WORK/shots" npx playwright test -c scripts/readme-shots/playwright.config.ts
node scripts/readme-shots/site.mjs "$WORK/shots"

# 2x captures, at most 2400 px wide: sharp on Retina at README width, light in the repo. The website's film grain
# compresses far better as JPEG; the app's flat UI stays PNG.
mkdir -p "$OUT"
for file in "$WORK"/shots/*.png; do
  width=$(sips -g pixelWidth "$file" | awk '/pixelWidth/ { print $2 }')
  if [ "$width" -gt 2400 ]; then sips --resampleWidth 2400 "$file" >/dev/null; fi
  name=$(basename "$file" .png)
  case "$name" in
    banner | compare | workflow | branch-out-merge-in) sips -s format jpeg -s formatOptions 82 "$file" --out "$OUT/$name.jpg" >/dev/null ;;
    *) cp "$file" "$OUT/" ;;
  esac
done
ls -lh "$OUT"
