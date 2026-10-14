# Releasing

Releases are cut from `main` by pushing a `v*` tag. `.github/workflows/release.yml` then builds the
unsigned (ad-hoc signed) `.dmg` and `.zip` for arm64 and x64 and attaches them to a **draft** GitHub
Release. Nothing is published until you publish the draft.

## Cut a release

1. **Bump the version** in `package.json` (SemVer; `0.2.0`, `0.1.1`, `0.2.0-beta.1`). Run
   `npm install --package-lock-only` so `package-lock.json` follows.
2. **Update `CHANGELOG.md`.** Move the `[Unreleased]` entries under a new `## [x.y.z] - YYYY-MM-DD`
   heading (short lines, Chinese + English), and update the compare links at the bottom. The workflow
   uses exactly this section as the release notes, so the heading must contain `[x.y.z]`.
3. **Check locally.**
   ```bash
   npm run check
   npm run test:e2e
   npm run dist:dir && npm run test:packaged   # packaged arm64 app: shell, hook script, Claude launch
   ```
   `npm run dist` builds all four installers into `release/<version>/` (about 2 minutes). `release/` is
   gitignored.
4. **Commit and tag.**
   ```bash
   git commit -am "chore(release): v0.1.0"
   git tag v0.1.0
   git push origin main v0.1.0
   ```
   The tag must equal `v` + the `package.json` version, otherwise the workflow stops at its first step.
5. **Wait for the workflow** (Actions → Release). It runs `npm ci`, `npm run check`, `npm run dist`,
   verifies both signatures, launches the packaged arm64 app (`npm run test:packaged`), then creates the
   draft release with these assets:
   - `Terminal-Reborn-<version>-arm64.dmg` / `-arm64.zip` (Apple Silicon)
   - `Terminal-Reborn-<version>-x64.dmg` / `-x64.zip` (Intel)
6. **Publish the draft** on the Releases page after reading the notes. A version with a hyphen
   (`-beta.1`) is created as a pre-release; the in-app update check ignores pre-releases.

Re-running the workflow for the same tag replaces the assets of the existing release instead of failing.
To redo a bad tag: delete the draft release and the tag (`git push origin :refs/tags/v0.1.0`), fix, retag.

## Update check

The app asks `https://api.github.com/repos/<owner>/<repo>/releases/latest` (owner/repo from the
`repository` field of `package.json`) 10 s after launch and every 24 h, and shows one notification per
new version. Only published, non-draft, non-pre-release releases count, so publishing the draft is what
makes users hear about it. If the repository is renamed, change `repository` and `homepage` in
`package.json` and the links in `README.md` and `CHANGELOG.md`. `TR_DISABLE_UPDATE_CHECK=1` turns the
background check off.

## About the signature

Builds are signed ad-hoc (`identity: '-'`, hardened runtime, Electron's default entitlements including
`disable-library-validation`, which node-pty needs). That is enough for `codesign --verify --deep
--strict` to pass and for the app to run, but Gatekeeper rejects it after download, hence the one-time
`xattr -cr "/Applications/Terminal Reborn.app"` documented in the README.

To move to a Developer ID later (needs an Apple Developer account):

1. Put the Developer ID Application certificate in the CI keychain (`CSC_LINK`, `CSC_KEY_PASSWORD`
   secrets) and replace `identity: '-'` in `electron-builder.yml` with the certificate name (or remove it
   so electron-builder auto-discovers it).
2. Add `notarize: true` under `mac:` and the notarization credentials (`APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) as secrets exposed to the build step.
3. Then drop the `xattr` step from the README. For true auto-update add `electron-updater` (PRD §7);
   the GitHub provider is already configured under `publish:`.

## Build notes

- `npmRebuild: false`: node-pty is N-API and ships per-arch prebuilds; rebuilding from source would put a
  host-arch `build/Release/pty.node` (preferred by node-pty over `prebuilds/`) into the other arch's bundle.
  `node-pty/build` is excluded from the bundle for the same reason.
- `build/after-pack.cjs` sets the exec bit on `spawn-helper` inside the bundle before signing, so a
  missing bit in `node_modules` never reaches users. The runtime fallback in `src/pty-host` stays dev-only.
- The hook relay is shipped as an extra resource at `Contents/Resources/hooks/tr-hook.sh`
  (`hookScriptPath()` in `src/main/hooks`).
- The icon master is `build/icon.svg`; `npm run icon` regenerates `build/icon.icns` and `build/icon.png`.
