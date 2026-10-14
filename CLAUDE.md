# Terminal Reborn — agent guide

macOS terminal for running many CLI coding agents (Claude Code, Codex) in parallel. Electron + xterm.js + node-pty + React 19 + zustand, built with electron-vite.

- Product spec and roadmap: `docs/PRD.md` (read the section your task points to before coding).
- Design source of truth: Figma `x6HGsLiMTk7fWDoKI5YkKh` — screen node IDs are in PRD §5. Use the Figma MCP (`get_design_context` / `get_screenshot`) on the exact node you are implementing.
- Task briefs for parallel work: `docs/tasks/`.

## Commands

```bash
npm run dev        # app with hot reload
npm run check      # typecheck + lint + vitest — must pass before every commit
npm run test:e2e   # build + Playwright Electron smoke test
```

In a fresh worktree run `npm install` first.

## Layout and ownership

| Path | What | Owner |
|---|---|---|
| `src/shared/` | Pure, typed contracts and logic shared by main + renderer (`types`, `ipc`, `agent-events`, `send-protocol`, `keys`, `session-status`) | integrator — **additive changes only** from tracks, call them out in the commit message |
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
| `src/renderer/command-palette/` | ⌘K (M2) | `command-palette` |

Stay inside the directories your task owns. If you truly need a change elsewhere, keep it minimal and say so in the commit message — don't refactor shared files.

## Conventions

- TypeScript strict; no `any`. Pure logic goes in `src/shared/` or a feature's `*.ts` file with a colocated `*.test.ts` (Vitest).
- Styling: CSS Modules (`*.module.css`). Colors, spacing, radii and type **only** via variables in `src/renderer/styles/tokens.css`. Verify both themes (`<html data-theme="dark|light">`).
- Design taste: quiet and systematic — chroma-0 neutrals, color only for status, hierarchy from type/alignment/hairlines, small radii, no cards/gradients/decorative captions. Status is never color-only (StatusGlyph shape + text).
- Icons: `lucide-react`, `size={16} strokeWidth={1.75}`.
- CJK: always keep a CJK family in font stacks; CJK occupies 2 terminal cells.
- UI copy in Chinese; code, comments, commit messages in English. Conventional Commits (`feat(composer): …`).
- Security: `contextIsolation` + `sandbox` stay on; renderer reaches the system only through `window.tr`. Validate every IPC payload in main.
- Never write to the user's global agent config (`~/.claude/settings.json`, `~/.codex/*`). Hooks are injected per launch (PRD §6.2).
- Adapted third-party code: MIT / Apache-2.0 / BSD only, attribute in file header and `THIRD_PARTY_NOTICES.md`.
