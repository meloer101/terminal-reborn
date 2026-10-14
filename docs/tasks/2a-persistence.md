# Task: persistence — workspace in main, resume conversations (phase 2a · A2, A12)

Read `docs/phase2/plan.md` (A2, A12, decisions) and `CLAUDE.md` first.

## You own
- `src/main/workspace-store.ts` (replace the placeholder), `src/renderer/state/workspace.ts`, `src/renderer/state/workspace-model.ts` (+ tests), `src/renderer/composer/drafts.ts` (+ test)
- `src/main/hooks/normalize.ts` — only to fill `agentSessionId` on `session-start` (Claude and Codex `session_id`), with tests
- `src/shared/agent-launch.ts` (+ tests) — resume arguments; `src/pty-host/` + `src/main/pty/` only to pass `resumeAgentSessionId` through
- window bounds persistence in `src/main/windows.ts` (coordinate: the lifecycle track also edits this file — keep your change to a small `restoreBounds/saveBounds` helper)

## Requirements
1. **Main-owned store:** `<userData>/workspace.json`, atomic write (tmp + rename), debounced (~300 ms), versioned (`version: 2`), sanitized on read. `window.tr.workspace.loadSync()` returns it at renderer startup; `save()` writes. On first run with no file, migrate once from renderer localStorage (`tr.workspace.v1` + composer drafts key) and then stop using localStorage. e2e fixture mode (`__TR_E2E__`) keeps working.
2. **Drafts** move into the same store (or a sibling file), debounced, and are deleted when their session closes.
3. **What persists:** projects, worktrees, sessions (id, kind, title, `agentSessionId`), active session, sidebar collapsed, right panel tab, drafts; window bounds (+ maximized/fullscreen) in main.
4. **Capture conversation ids:** `normalize` sets `agentSessionId` from the hook's `session_id` on SessionStart (Claude and Codex); the status bridge / workspace stores it on the session via `patchSession` (add `agentSessionId` to `SessionPatch`) and it persists. A later SessionStart with a different id (e.g. after `/clear`) replaces it.
5. **Resume on first view (decision):** sessions restored from disk get `phase: 'not-started'` and are NOT spawned until viewed. On first view, spawn with `resumeAgentSessionId` when present: Claude `claude --resume <id>`, Codex `codex resume <id>` (verify the exact Codex 0.142.5 syntax with `codex --help`; no model turns needed). Expose `startSession(sessionId, { resume: boolean })` in `src/renderer/session-io.ts`-adjacent code (e.g. `src/renderer/state/session-start.ts`) so the UI track can call "恢复对话" / "开始新对话"; until the UI exists, default to resume.
6. `startedAt` must not reset on restore.

## Real-CLI check
At most 4 short Claude turns in the trusted lab `/tmp/tr-hooks-lab` (strip CLAUDECODE / CLAUDE_CODE_* / CLAUDE_AGENT_*): confirm SessionStart carries `session_id`, and that `claude --resume <id>` in a fresh PTY shows the previous conversation. Never touch global config.

## Done when
- Unit tests: store sanitize/migrate, resume argv (both agents, shell-quoted), normalize id capture, draft deletion.
- e2e (`e2e/persistence.spec.ts`, `e2e/launch.ts` with a fixed temp profile across two launches): workspace, drafts, active session, window bounds survive relaunch; restored sessions are `not-started` until viewed.
- `npm run check` and `npm run test:e2e` pass.
