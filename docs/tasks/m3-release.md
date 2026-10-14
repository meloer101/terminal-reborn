# Task: release — packaged app, icon, update check, release pipeline for v0.1.0

Milestone M3 · PRD §7 (unsigned for now: ad-hoc signature, no notarization, no auto-install) · Branch/worktree: `release`

## Goal
`npm run dist` produces a working Terminal Reborn.app (dmg + zip, arm64 + x64) that runs agents exactly like the dev build; a tag push builds and attaches artifacts to a GitHub Release; the app tells users when a newer release exists.

## You own
- `build/` (icon + any entitlements), `electron-builder.yml`, `package.json` (version → `0.1.0`, scripts, `repository` field), `.github/workflows/release.yml` (new), `src/main/updates.ts` (new; replace the stub `appCheckForUpdates` handler in `src/main/index.ts` — one-line change), `README.md`, `CHANGELOG.md` (new), `docs/releasing.md` (new).
Don't touch renderer feature code.

## Requirements
- **Packaged app works:** build arm64 locally (`electron-builder --mac --arm64 dir` is fine for iteration) and launch the packaged binary: verify the pty-host forks, node-pty spawns (asarUnpack + `spawn-helper` exec bit inside the bundle — fix at build time, never at runtime), `resources/hooks/tr-hook.sh` is found at `process.resourcesPath/hooks` and executes, a Claude session starts (trivial launch only, no prompts). Automate what you can with Playwright `_electron.launch({ executablePath })`.
- **Signing:** ad-hoc (`identity: '-'` already). Confirm `codesign --verify --deep` passes on the built app and that the hardened runtime / entitlements don't break node-pty; document the one-time `xattr -cr` for users (README already mentions it — keep it accurate).
- **Icon:** design a restrained app icon consistent with the product's taste (chroma-0 neutrals, no gradients/glow, a simple terminal-prompt mark is fine; macOS squircle per Apple template, 1024 px master as SVG in `build/icon.svg`) and generate `build/icon.icns` with `sips` + `iconutil` (script it in `scripts/make-icon.sh`). Keep it simple; the user may replace it.
- **Update check (`src/main/updates.ts`):** read `owner/repo` from `package.json` `repository` (set it to `github:meloer101/terminal-reborn` — the integrator will confirm the real name with the user), GET `https://api.github.com/repos/<owner>/<repo>/releases/latest` with a 5 s timeout, compare semver with `app.getVersion()`, return `UpdateInfo | null`, never throw. Also check once ~10 s after launch (and every 24 h) and show one system notification per new version (`Notification`, click opens the release page). Pure semver/parse helpers tested; no network in tests.
- **Release workflow:** on `v*` tags, macOS runner, `npm ci`, `npm run check`, build dmg+zip for arm64 and x64, create/attach to a draft GitHub Release using `GITHUB_TOKEN`. No secrets beyond that. Do not push anything or create remote repos — just commit the workflow.
- **Docs:** `docs/releasing.md` (bump version, update CHANGELOG, tag, push, publish the draft), `CHANGELOG.md` with a 0.1.0 entry summarizing M0–M3 features (Chinese + English short lines), README install section (download from Releases, `xattr -cr`, requirements: macOS 13+, Claude Code / Codex installed).

## Done when
- A locally built packaged app passes your launch check (report the bundle size and what you verified).
- `npm run check` and `npm run test:e2e` pass.
- Commits on your branch; nothing pushed.
