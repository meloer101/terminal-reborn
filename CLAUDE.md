# Wavi — agent guide

macOS terminal for running many CLI coding agents (Claude Code, Codex) in parallel. Electron + xterm.js + node-pty + React 19 + zustand, built with electron-vite.

- Product spec: `docs/PRD.md` — what the product should become (read the section your task points to before coding). Measured CLI / daemon behaviour is in PRD §6.6–§6.9.
- Progress: `docs/ROADMAP.md` — what is done, in progress and not started.
- Design source of truth: Figma `x6HGsLiMTk7fWDoKI5YkKh` — screen node IDs are in PRD §5. Use the Figma MCP (`get_design_context` / `get_screenshot`) on the exact node you are implementing.

**These are the only two docs.** When a product decision changes, edit `docs/PRD.md` and add a line to its 变更记录. When you finish, add or drop work, tick or move it in `docs/ROADMAP.md` and bump its date, in the same commit as the code. Do not create task briefs, plans, acceptance records, spikes or research files; put a short brief in the session or PR instead, and fold new measured findings into PRD §6.

## Commands

```bash
npm run dev        # app with hot reload (own "Wavi Dev" profile, never the installed app's)
npm run app:install  # /Applications/Wavi.app linked to this checkout; `npm run build` updates it
npm run check      # typecheck + lint + vitest — must pass before merging into main
npm run test:e2e   # build + Playwright Electron smoke test — the full run, before merging into main
```

In a fresh worktree run `npm install` first. While developing, run `npm run typecheck`, `npm run lint` and only the tests of what changed (`npx vitest run <paths>`, `npx playwright test e2e/<spec> --project=parallel` after `npx electron-vite build`); the full `npm run check` and `npm run test:e2e` run once before a branch merges into main. A full-run failure unrelated to the change (load timeouts in the git-heavy tests) is rerun alone, not with another full run.

## Layout and ownership

| Path | What | Owner |
|---|---|---|
| `src/shared/` | Pure, typed contracts and logic shared by main + renderer (`types`, `ipc`, `agent-events`, `settings`, `send-protocol`, `keys`, `session-status`) | integrator — **additive changes only** from tracks, call them out in the commit message |
| `src/main/` | Electron main: window, IPC handlers, (later) hook server, git | integrator; `pty-terminal` adds `src/main/pty/` |
| `src/pty-host/` | utilityProcess owning node-pty | `pty-terminal` |
| `src/preload/` | `window.tr` (implements `TrApi` from `src/shared/ipc.ts`) | `pty-terminal` may change transport, not the `TrApi` shape |
| `src/renderer/app-shell/`, `state/`, `session-io.ts`, `ui/`, `styles/` | Layout, workspace store, integration seam, shared UI atoms, tokens | integrator |
| `src/renderer/terminal/` | `TerminalSurface` + xterm implementation | `pty-terminal` |
| `src/renderer/composer/` | Input box | `composer` |
| `src/renderer/sidebar/` | Status sidebar | `sidebar-ui` |
| `src/renderer/panels/` | Right panel (changes / graph) | later milestones |
| `src/main/hooks/`, `resources/hooks/`, `src/shared/agent-launch.ts` | Per-launch Claude hooks → `AgentEvent` / `PendingPrompt` (M2) | `hooks-bridge` |
| `src/renderer/status/`, `src/shared/session-state-machine.ts`, `src/shared/current-action.ts` | Live status, notifications, Dock badge (M2) | `session-status` |
| `src/renderer/prompt-bar/`, `src/shared/question-keys.ts` | Permission / question bar (M2) | `prompt-bar` |
| `src/shared/gui-chat.ts`, `src/main/gui/`, `src/renderer/gui/` | GUI sessions: headless Claude / Codex / ACP agents drawn as a chat (F23) | `gui-sessions` |
| `src/renderer/command-palette/` | ⌘K (M2) | `command-palette` |
| `src/renderer/settings/` | Settings dialog UI (M3; a sheet over the main window) | `settings-ui` |
| `src/renderer/appearance/`, `src/main/appearance.ts`, `src/renderer/theme.ts` | Applying appearance settings (M3) | `appearance-runtime` |
| `src/main/hooks/` (Codex parts) | Codex hooks/approvals (M3) | `codex-adapter` |
| `site/` | Website: Astro project with its own `package.json` (`cd site && npm install && npm run dev`, `npm run check`); GSAP and Lenis from npm, fonts are self-hosted subsets; deployed to Vercel (project root `site/`) and GitHub Pages (`.github/workflows/pages.yml`); English at `/`, Chinese at `/zh/` (page copy in `site/src/i18n.ts`, replica text in `site/src/scripts/data.ts`); design is the Figma page 「官网 · W5 重塑（噪音门面）」, frame W11 | integrator |
| `ios/` | iPhone app (PRD F22): native SwiftUI, iOS 26, Swift 6. `cd ios && xcodegen` writes `Wavi.xcodeproj` from `project.yml` (generated, git-ignored); `xcodebuild test -scheme Wavi -destination 'platform=iOS Simulator,name=iPhone 17 Pro'` runs `WaviTests`. Crypto matches the Mac byte for byte against `src/shared/remote-vectors.json`, and status words, agent names and marks, lucide icons and branch words come from the desktop through `Resources/Shared.json` and `Assets.xcassets/{Agents,Lucide}` — all written by `src/main/remote/vectors.test.ts` / `phone-assets.test.ts` (`WAVI_WRITE_VECTORS=1` / `WAVI_WRITE_PHONE_ASSETS=1`), never edited by hand. ristretto255 for the PAKE is vendored from libsodium in `Packages/Ristretto255` (ISC). The Live Activity (Dynamic Island, Lock Screen) is the `WaviActivity` widget extension: the app builds its state (`Wavi/Model/ActivityState.swift`), `LiveActivity/` is compiled into both targets (attributes, the `LiveActivityIntent` buttons, which answer only in the app's process). The simulator caps Live Activities system-wide, so other apps' activities can make `Activity.request` fail; test on a fresh simulator. Design is Figma sections 46′ / 46″ / 47; signing team `U9XR52C9HW`, bundles `app.wavi.remote` and `app.wavi.remote.activity` | integrator |
| `launch-videos/` | Launch films: one HyperFrames project per film (`a-waiting`, `b-question-marks`, `c-three-answers`; storylines in `launch-videos/STORYLINES.md`, each project's `SPEC.md` / `REVIEW.md`); work through the HyperFrames skills, `npx hyperframes preview` / `check` / `render` inside a project; scenes are authored at 1x and played at `SPEED` 1.5; renders, previews and caches are git-ignored | integrator |
| `build/`, `electron-builder.yml`, `.github/workflows/release.yml`, `src/main/updates.ts` | Packaging, icon, update check (M3) | `release` |

Stay inside the directories your task owns. If you truly need a change elsewhere, keep it minimal and say so in the commit message — don't refactor shared files.

## Conventions

- Every agent, not just two: research, comparisons, designs and code that touch agents cover all the agents Wavi supports (`src/shared/agents.ts`, GUI drivers in `src/shared/gui-agents.ts`), not only Claude Code and Codex. List the ones that could not be measured or checked (not installed, no access) instead of leaving them out.
- TypeScript strict; no `any`. Pure logic goes in `src/shared/` or a feature's `*.ts` file with a colocated `*.test.ts` (Vitest).
- Styling: CSS Modules (`*.module.css`). Colors, spacing, radii and type **only** via variables in `src/renderer/styles/tokens.css`. Verify both themes (`<html data-theme="dark|light">`).
- Design taste: quiet and systematic — chroma-0 neutrals, color only for status, hierarchy from type/alignment/hairlines, small radii, no cards/gradients/decorative captions. Status is never color-only (StatusGlyph shape + text).
- Icons: `lucide-react`, `size={16} strokeWidth={1.75}`.
- CJK: always keep a CJK family in font stacks; CJK occupies 2 terminal cells.
- UI copy in Chinese; code, comments, commit messages in English. Conventional Commits (`feat(composer): …`).
- Security: `contextIsolation` + `sandbox` stay on; renderer reaches the system only through `window.tr`. Validate every IPC payload in main. Folder roots from the renderer must be workspace folders (`isWorkspaceDir` / `isProjectRoot`); the renderer declares those folders, so this keeps a wrong path out and is no boundary against a renderer that is not ours. Every agent runs as the same user, so the hook socket token only keeps other users out, not one session's agent from another's.
- Never write to the user's global agent config (`~/.claude/settings.json`, `~/.codex/*`). Hooks are injected per launch (PRD §6.2).
- Adapted third-party code: MIT / Apache-2.0 / BSD / ISC only, attribute in file header and `THIRD_PARTY_NOTICES.md`.
