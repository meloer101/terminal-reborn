#!/usr/bin/env bash
# Checks a Developer ID release in release/<version>/ the way Gatekeeper will see a download: every .app, dmg and
# zip is signed with one Developer ID team, has the hardened runtime, carries a stapled notarization ticket and is
# accepted by spctl as "Notarized Developer ID". Exits non-zero on the first failure. Used by release.yml; runs
# locally on a downloaded or freshly built release too.
#
# Usage: scripts/verify-mac-release.sh [release/<version>]
# Every check ends in `|| fail`, so it still stops when called where `set -e` is off (the dmg subshell below).
set -euo pipefail

dir="${1:-release/$(node -p "require('./package.json').version")}"
[ -d "$dir" ] || { echo "no such directory: $dir" >&2; exit 1; }
fail() { echo "::error::$*" >&2; exit 1; }
team=''

# Signed by a Developer ID (not ad hoc, not Apple Development), all with the same team.
check_signer() {
  local path="$1" info id
  info="$(codesign -dv --verbose=4 "$path" 2>&1)" || true
  grep -q '^Authority=Developer ID Application: ' <<<"$info" || fail "$path: not signed with a Developer ID Application certificate"
  id="$(sed -n 's/^TeamIdentifier=//p' <<<"$info")"
  [ -n "$id" ] && [ "$id" != 'not set' ] || fail "$path: no team identifier"
  if [ -z "$team" ]; then team="$id"; elif [ "$id" != "$team" ]; then fail "$path: team $id, expected $team"; fi
}

check_app() {
  local app="$1" assessment
  echo "== $app"
  codesign --verify --deep --strict --verbose=2 "$app" || fail "$app: codesign --verify --deep --strict failed"
  check_signer "$app"
  codesign -dv "$app" 2>&1 | grep -q 'flags=.*runtime' || fail "$app: hardened runtime is off"
  # The Mach-O files outside the frameworks, which electron-builder signs from the bundle walk.
  while IFS= read -r -d '' file; do
    if file -b "$file" | grep -q 'Mach-O'; then
      codesign --verify --strict "$file" || fail "$file: bad signature"
      check_signer "$file"
      codesign -dv "$file" 2>&1 | grep -q 'flags=.*runtime' || fail "$file: hardened runtime is off"
    fi
  done < <(find "$app/Contents/Resources" "$app/Contents/MacOS" -type f -print0)
  xcrun stapler validate "$app" || fail "$app: no stapled notarization ticket"
  assessment="$(spctl -a -vvv -t exec "$app" 2>&1)" || true
  echo "$assessment"
  grep -q 'source=Notarized Developer ID' <<<"$assessment" || fail "$app: Gatekeeper does not accept it as notarized"
}

shopt -s nullglob
apps=("$dir"/mac*/*.app)
dmgs=("$dir"/*.dmg)
zips=("$dir"/*.zip)
[ ${#apps[@]} -gt 0 ] || fail "no .app under $dir"

for app in "${apps[@]}"; do check_app "$app"; done

for dmg in "${dmgs[@]}"; do
  echo "== $dmg"
  codesign --verify --strict --verbose=2 "$dmg" || fail "$dmg: bad signature"
  check_signer "$dmg"
  xcrun stapler validate "$dmg" || fail "$dmg: no stapled notarization ticket"
  # Disk images are assessed as documents to open; `-t install` is for installer packages.
  assessment="$(spctl -a -vvv -t open --context context:primary-signature "$dmg" 2>&1)" || true
  echo "$assessment"
  grep -q 'source=Notarized Developer ID' <<<"$assessment" || fail "$dmg: Gatekeeper does not accept it as notarized"
  mount="$(mktemp -d)"
  hdiutil attach -nobrowse -readonly -noverify -mountpoint "$mount" "$dmg" >/dev/null
  status=0
  # check_app stops with `fail` (exit), so run it in a subshell to detach the image either way.
  (check_app "$mount"/*.app) || status=$?
  hdiutil detach "$mount" -quiet || hdiutil detach "$mount" -force -quiet
  [ "$status" -eq 0 ] || fail "$dmg: the app inside does not pass"
done

for zip in "${zips[@]}"; do
  echo "== $zip"
  out="$(mktemp -d)"
  ditto -x -k "$zip" "$out"
  check_app "$out"/*.app
  rm -rf "$out"
done

echo "OK: ${#apps[@]} app(s), ${#dmgs[@]} dmg(s), ${#zips[@]} zip(s) signed by team $team and notarized"
