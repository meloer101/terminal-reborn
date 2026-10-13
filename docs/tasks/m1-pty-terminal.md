# Task: pty-terminal — real terminals in the window

Milestone M1 · PRD §6.1, §6.3, F1 key mappings · Branch/worktree: `pty-terminal`

## Goal
Every session in the sidebar is a real, fast terminal: PTYs live in an Electron utilityProcess, xterm.js renders them in the main area, and switching sessions keeps each terminal alive.

## You own
- `src/pty-host/` — utilityProcess entry (already wired as build entry `out/main/pty-host.js`)
- `src/main/pty/` (new) — forks the pty-host, relays IPC; register it from `src/main/index.ts` with **one** line next to `registerFileHandlers()`
- `src/preload/index.ts` — you may change the transport (e.g. MessagePort for data) but `TrApi` in `src/shared/ipc.ts` must keep its shape
- `src/renderer/terminal/` — `TerminalSurface` interface (`surface.ts`, keep it), xterm implementation, `TerminalArea.tsx`

## Requirements
**PTY host**
- `node-pty` spawn with the user's login shell (`$SHELL -l`) when `command` is absent; env adds `TERM=xterm-256color`, `COLORTERM=truecolor`, `LANG` with UTF-8, `TERM_PROGRAM=TerminalReborn`.
- Batch output (flush every ~8 ms or 64 KB) to keep IPC overhead low under floods.
- Kill all PTYs on app quit; report exits via `onExit`. Validate all IPC payloads in main.
- Missing/nonexistent `cwd` (mock data uses fake paths) → fall back to `window.tr.homeDir`.

**XtermSurface** (implements `TerminalSurface`)
- WebGL renderer with **per-terminal** fallback to DOM on context loss/failure; unicode11 addon active; web-links addon (open via shell in main, already handled by window open handler); fit addon.
- Font stack `"<latin>", "<cjk>", monospace` (defaults: `JetBrains Mono Variable` + `PingFang SC`), `rescaleOverlappingGlyphs: true`, line height from the Figma style Mono/Terminal (13px / 20px). Call `clearTextureAtlas()` after `document.fonts.ready` and on appearance change.
- Theme from CSS variables (`--term-*`, `--term-selection`); re-apply when `<html data-theme>` changes.
- Kitty keyboard protocol stays off. macOS mappings: ⌘⌫ → `\x15`, ⌘← / ⌘→ → `\x01` / `\x05`, ⌥← / ⌥→ → `\x1bb` / `\x1bf`.
- `readScreen()` returns viewport + N lines of scrollback as plain text (the send executor depends on this).
- Title (OSC 0/2) and generic OSC subscription via `parser.registerOscHandler`.

**TerminalArea**
- One surface per session in `useWorkspace().sessions`, spawned lazily on first view; hidden sessions stay mounted (`display:none`), refit + resize on show and on container resize (ResizeObserver).
- Export a registry `src/renderer/terminal/registry.ts`: `getSurface(sessionId)` and `getSendIo(sessionId): SendIo` (from `src/shared/send-protocol.ts`) — the integrator wires the composer to this after merge.
- Clicking the terminal focuses it; it must not steal focus from the composer on session switch.

## Done when
- `zsh`, `vim`, `htop`, `less`, `claude` run correctly; CJK text aligns to 2 cells; resizing the window reflows; switching sessions preserves scrollback.
- `cat` of a 10 MB file doesn't freeze the UI.
- e2e test added in `e2e/terminal.spec.ts`: type `echo hello` into the terminal and see `hello` in `readScreen()`.
- `npm run check` and `npm run test:e2e` pass. Screenshots in dark + light in the final commit description.
