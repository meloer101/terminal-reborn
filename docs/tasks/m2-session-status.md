# Task: session-status — live status, current action, notifications

Milestone M2 · PRD §3 (state machine + self-heal), §4 F2 · Branch/worktree: `session-status`

## Goal
The sidebar and header show each session's real status and current action, driven by agent events, with self-healing when signals are missing; the user is notified (system notification + Dock badge) only when a session needs them and they aren't looking.

## You own
- `src/shared/session-state-machine.ts` (+ test): pure reducer.
- `src/shared/current-action.ts` (+ test): tool → Chinese one-liner.
- `src/renderer/status/` — replace the `StatusBridge` placeholder (mounted by AppShell; renders nothing).

Use, don't edit: `window.tr.agent.onEvent` (events, see `src/shared/agent-events.ts`), `window.tr.pty.onExit`, terminal titles via `getSurface(id)?.onTitleChange` (`src/renderer/terminal/registry.ts`), `useWorkspace` + its `patchSession` action, `window.tr.ui.setBadge` / `notify` / `onNotificationClick`, `needsAttention` in `src/shared/session-status.ts`.

The real event source (hooks) is built in parallel by the `hooks-bridge` track, so drive everything from fixtures in tests and from synthetic events in Playwright (emit through a test hook you add in `src/renderer/status/` when `globalThis.__TR_E2E__` is set — don't edit preload).

## Requirements
- **Reducer** `(state, signal, now) → state` where signals = agent events, pty exit (code), title change, "viewed" (session became visible with window focused), tick. State holds `status`, `currentAction`, `lastEventAt`, `lastActivityAt`. Transitions per PRD §3.1:
  - prompt-submit / tool-start / tool-end → `running` (tool-start sets currentAction; AskUserQuestion tool-start → `needs_you`)
  - notification kind permission|question → `needs_you`; after a needs_you, tool-end / prompt-submit → back to `running`
  - stop → `done_unread` if not currently viewed, else `idle`; viewed + done_unread → `idle`
  - stop-failure, or pty exit ≠ 0 while running → `error`; pty exit / session-end → `exited`
  - self-heal: `running` with no event for 3 min and a Claude idle title (`✳` prefix) → `idle`; a `needs_you` that the user answered in the TUI resolves on the next event.
  - Shell sessions (`kind === 'shell'`) stay `idle` / `exited` only.
- **Current action** from tool + input: Read → "读取 a.ts", Edit/Write/MultiEdit → "编辑 a.ts", Bash → "运行 <first 40 chars>", Grep/Glob → "搜索 'q'", WebFetch → "抓取 host", Task → "子任务：…", unknown → tool name. Use basename for paths; clear on stop.
- **Bridge:** subscribes once, keeps per-session reducer state, calls `patchSession` only on change; one shared 1 s/15 s tick for self-heal.
- **Notifications:** when a session enters `needs_you`, `error`, or `done_unread` and (window not focused OR session not active): `ui.notify({ title: session title, body: 等你处理 / 出错 / 已完成 + action, tag: sessionId })`. Clicking → `setActiveSession(tag)`. Never notify for the session the user is looking at. Dock badge = count of `needsAttention` sessions, updated on change.
- Window focus/visibility: `document.hasFocus()` + `visibilitychange` / `focus` / `blur`.

## Done when
- Table-driven reducer tests cover every transition and self-heal rule; current-action tests cover each tool.
- Playwright: inject synthetic events → sidebar row and header change status within 1 s; badge count calls observed (spy via the test hook).
- `npm run check` and `npm run test:e2e` pass.
