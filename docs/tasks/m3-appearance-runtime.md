# Task: appearance-runtime — apply appearance settings to the running app

Milestone M3 · PRD §4 F7, research report §2.2 · Branch/worktree: `appearance-runtime`

## Goal
Whatever is set in `AppSettings.appearance` (`src/shared/settings.ts`) takes effect in every window within 100 ms, without restarting sessions: theme, terminal fonts/size/line height/ligatures, background, terminal opacity, sidebar vibrancy.

## You own
- `src/renderer/appearance/` — replace the `AppearanceBridge` placeholder (mounted by AppShell; renders nothing).
- `src/main/appearance.ts` (new) — main-side effects (vibrancy, window background color); register from `src/main/index.ts` with one line.
- `src/renderer/theme.ts` — migrate the theme preference to settings (keep `applyTheme` / `initTheme` exports working; read the initial preference from settings, migrating the old `tr.theme.v1` localStorage value once).
- Minimal, called-out edits allowed in: `src/renderer/terminal/` (applying appearance to all surfaces, a ligatures addon if you add it), `src/renderer/command-palette/run.ts` (theme actions should go through `settings.update`), `src/renderer/app-shell/AppShell.module.css` (background layers), `src/renderer/sidebar/Sidebar.module.css` / AppShell sidebar background (transparent when vibrancy is on).

Use, don't edit: `window.tr.settings.get / update / onChange`, `getSettings` / `onSettingsChange` in `src/main/settings.ts`.

## Requirements
- **Boot:** the main window reads settings before first paint where it matters (theme → `data-theme`; window `backgroundColor` in main so there's no flash of the wrong color).
- **Terminals:** all existing and future `XtermSurface`s get `{ fontFamily: latinFont, cjkFontFamily: cjkFont, fontSize, lineHeight, ligatures }`; after a font change wait for `document.fonts.load()` of both families, then `clearTextureAtlas()` and refit so cols/rows update and the PTY gets resized. Ligatures: `@xterm/addon-ligatures` if it works with the WebGL renderer in xterm 6 — otherwise keep the toggle stored but inert and say so.
- **Background:** `solid` = current look. `gradient` / `image` render behind the terminal area (image via a `file://` URL — check CSP `img-src` allows it, it does `file:`; use `object-fit: cover` and a `dim` overlay using the theme background color). The terminal surface gets `terminalOpacity` via its background alpha; respect research §2.2: xterm transparency has rendering bugs, so only enable `allowTransparency` when opacity < 1 or background ≠ solid, and verify there are no black-cell artifacts with the WebGL renderer (fallback: DOM renderer for that terminal when transparent, document the trade-off).
- **Sidebar vibrancy:** main sets `win.setVibrancy('sidebar')` (or `null`) on change; the sidebar background becomes transparent/translucent only when on. Terminal area stays opaque-ish per PRD.
- **Theme:** `appearance.theme` drives `data-theme` in every window (follows system when `system`); command palette theme actions write settings.
- Pure mapping (settings → xterm options, settings → CSS variables/background style) in `*.ts` with Vitest tests.

## Done when
- Playwright (`e2e/appearance.spec.ts`, use `e2e/launch.ts`): `window.tr.settings.update({appearance:{fontSize:16, cjkFont:'Hiragino Sans GB'}})` → a terminal's options reflect it and its cols shrink; background gradient renders behind the terminal; theme change flips `data-theme`; screenshots dark + light with a gradient and with an image.
- Manual check noted in the report: vibrancy on/off visibly changes the sidebar.
- `npm run check` and `npm run test:e2e` pass.
