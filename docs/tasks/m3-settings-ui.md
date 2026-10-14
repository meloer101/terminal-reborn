# Task: settings-ui — 设置 · 外观 window

Milestone M3 · PRD §4 F7 · Figma screen 07 (21:1223), light-mode context 08 (24:1790); components ThemeSwatch (12:162), Select (12:126), Slider (12:137), Toggle (12:136), Segment (9:54), NavItem (11:81) · Branch/worktree: `settings-ui`

## Goal
The settings window (⌘, or sidebar 设置) with a working 外观 page: every control edits `AppSettings.appearance` live, and the preview on the right shows the result immediately.

## You own
- `src/renderer/settings/` — replace the `SettingsApp` placeholder. `main.tsx` already renders it when `location.hash === '#settings'`; main opens the 1200×800 window (`src/main/windows.ts`).

Use, don't edit: `window.tr.settings.get / update / onChange`, types + `LIMITS` + `DEFAULT_SETTINGS` in `src/shared/settings.ts`, `XtermSurface` / `buildFontStack` in `src/renderer/terminal/` for the preview (a standalone surface fed sample text, no PTY), tokens, `IconButton`.
The running app applies settings via the `appearance-runtime` track — you only edit settings. The settings window itself must follow `appearance.theme` too (a tiny `onChange` → `applyTheme` is fine inside your directory, or reuse whatever `appearance-runtime` exports later; keep it local for now).

## Requirements
- Layout per Figma 07: left nav (220 px, drag region titlebar with traffic-light space) — 外观 active; other items (通用, 终端, Agent, 快捷键, 关于) present but show a quiet "即将推出" pane, except 关于 which shows `window.tr.app.version` and a 检查更新 button calling `window.tr.app.checkForUpdates()` (show "已是最新版本" / the new version with a link).
- 外观 sections: 主题 (ThemeSwatch: 跟随系统 / 深色 / 浅色 — check how many swatches Figma has and what they mean), 字体 (英文字体, 中文字体 selects; 字号 select; 行高 slider; 连字 toggle), 窗口 (背景 segmented 纯色 / 渐变 / 图片 with the follow-up controls each needs: two color inputs + angle for gradient, file picker + 暗化 slider for image via `window.tr.files.pathForFile` on an `<input type=file accept="image/*">`; 终端不透明度 slider; 侧栏毛玻璃 toggle).
- **Font lists:** use the Local Font Access API (`window.queryLocalFonts()`) to list installed families; split into monospace-looking Latin candidates and CJK-capable families (heuristics: known CJK families / names containing SC, TC, JP, CJK, 黑, 宋, 楷, PingFang, Hiragino, Noto Sans …). The renderer may need a permission grant: if `queryLocalFonts` is denied, report it — the integrator will add a `session.setPermissionRequestHandler` for `local-fonts` in main. Always include the bundled `JetBrains Mono Variable` and `PingFang SC`, and allow typing a family name.
- Each font option renders in its own face (Latin sample "AaBb 0O1l", CJK sample "中文字体"), like a font menu.
- Preview (right column): an xterm surface showing a sample session (prompt, some ANSI colors, a CJK line aligned to a ruler) using the current appearance; caption below: "<latin> <size> · <cjk> · 行高 <lh>" as in Figma.
- Changes call `settings.update` immediately (debounce sliders ~50 ms); no Save button. Keyboard accessible; focus-visible rings.
- Pure helpers (font classification, caption text, form ↔ settings mapping) in `*.ts` with Vitest tests.

## Done when
- Matches Figma 07 in dark and the light equivalent; screenshots of both.
- Playwright (`e2e/settings.spec.ts`, use `e2e/launch.ts`): open settings via `window.tr.ui.openSettings()` (find the second window with `app.windows()`), change 字号 and 中文字体, assert `window.tr.settings.get()` reflects it and the preview font stack changed.
- `npm run check` and `npm run test:e2e` pass.
