# Task: agent-lifecycle — starting / blocked / exited / not-started states (phase 2a · A3, A4, A6, A7, A8 + B7)

Read `docs/phase2/plan.md` (A3, A4, A6, A7, A8, B7) first. Design: Figma screen **10** (node 64:2225) — sidebar rows, composer-area cards (Not started / Blocked / Exited), header "状态仅按标题判断".

## You own
- `src/shared/session-state-machine.ts` (+ tests), `src/renderer/status/` — phase tracking and status fixes
- `src/renderer/lifecycle/` (new) — the cards that replace the composer area; mount via AppShell (one line)
- `src/renderer/composer/` — disable when phase ≠ ready, placeholder "正在启动 Claude Code…"
- `src/renderer/sidebar/` — secondary line for phases; `src/renderer/session-header/` — hooks indicator
- `src/main/pty/` / `src/pty-host/` — preflight (`command -v claude|codex` in the login shell) and refusing to spawn in a missing directory (additive error codes)

## Requirements
- Phase per session (`AgentPhase`): starting on spawn → ready on SessionStart; blocked when `detectBlockingDialog` matches or no SessionStart within ~6 s while the screen shows a prompt (status becomes 等你处理 with "等你确认：信任此文件夹" etc.); exited on SessionEnd(reason ≠ clear/resume) or when the agent process is gone (shell prompt back); not-started comes from the persistence track.
- A4: SessionEnd must not freeze status; `/clear` → SessionStart revives it. Only PTY exit is terminal.
- A7: Claude self-heal like Codex (idle `✳` title + quiet hooks for N s → idle); heal 等你处理 when the TUI answered it.
- A3: composer disabled unless phase is ready (for agent sessions); Exited card offers 重新启动 / 恢复上次对话 via the persistence track's `startSession`.
- A8: preflight + missing-dir errors show in the session (card) with an install hint; hooks-health signal (from hooks-reliability) shows the header chip.
- B7: focus the terminal when a session is created/opened; when blocked, the card's 聚焦终端 focuses it.
