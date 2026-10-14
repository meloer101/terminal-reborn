# Task: lifecycle — never lose agents to a click (phase 2a · A1, A5, A11)

Read `docs/phase2/plan.md` (A1, A5, A11 and the decisions at the end) and `CLAUDE.md` first.

## You own
- `src/main/windows.ts`, `src/main/index.ts` (app/window lifecycle, menu), `src/main/activity.ts`
- `src/pty-host/` and `src/main/pty/` (hardening + host restart)
- `src/renderer/state/session-actions.ts` (confirmations), a new `src/renderer/state/activity.ts` (reports the summary)
- the "engine restarted" card in the main area — follow Figma screen **10** (node 64:2225), card "Engine restarted"; put the component in `src/renderer/lifecycle/`

## Requirements
1. **Close = hide.** The red close button hides the main window (agents keep running); clicking the Dock icon / `activate` shows it again. ⌘Q (and the app menu 退出) quits — when `getActivity().active > 0` (running or 等你处理 sessions) show a native confirm: "有 N 个会话正在运行或等你处理，退出会中断它们。" [退出] [取消]. Quitting from the Dock menu / system logout follows the same rule (logout must not hang: allow if the OS forces).
2. **Production menu:** remove View › Reload and Toggle Developer Tools from packaged builds (`app.isPackaged`); keep them in dev. Make sure ⌘R does nothing in packaged builds.
3. **Activity summary:** renderer reports `{ active }` via `window.tr.app.reportActivity` whenever the count of `running` + `needs_you` sessions changes (subscribe to `useWorkspace`).
4. **Confirm before destroying agents:** 关闭会话 when the session is running / 等你处理, and 移除项目 when any of its sessions is, via `window.tr.ui.confirm` (destructive). Menu label: "移除项目并关闭 N 个会话" when N > 0. ⌘W closes the active session with the same rule (bind it in the renderer, capture phase like ⌘N).
5. **pty-host hardening:** guard every per-session operation (write / resize / kill / ack) so one bad PTY can't throw; add `process.on('uncaughtException')` in the host that logs and keeps serving. Main: also add a main-process `uncaughtException` / `unhandledRejection` logger, `app.requestSingleInstanceLock()` (second launch focuses the existing window), and `render-process-gone` → reload the window (the workspace restores).
6. **Host crash recovery:** if the pty-host dies anyway, main restarts it once (backoff) and tells the renderer which sessions were lost (additive IPC, e.g. `pty:host-restarted` with session ids). Each affected session shows the "终端进程意外退出，已自动重启" card with 全部恢复, which respawns those sessions (use `resumeAgentSessionId` when the session has an `agentSessionId`; the persistence track provides it).

## Done when
- Unit tests for the quit-decision logic and confirmation rules (pure functions); e2e (`e2e/lifecycle.spec.ts`, `e2e/launch.ts`): closing the window hides it and PTYs stay alive; reopening via `activate` shows the same terminals; ⌘W confirm appears for a running session (stub `ui.confirm` is not possible through contextBridge — assert via a main-side test hook or by checking the dialog was requested); killing the host process restarts it and the card appears.
- `npm run check` and `npm run test:e2e` pass.
