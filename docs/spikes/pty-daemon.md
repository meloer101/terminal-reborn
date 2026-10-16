# Design: detached PTY daemon (agents survive quit, relaunch reattaches)

Status: **approved and implemented** (2026-10-16; §14 answered with the recommendations, see §15) · PRD §M6 "会话在应用重启后保留（PTY 守护进程 + `claude --resume`）"
Reference: Orca (MIT) `src/main/daemon/*`, `src/renderer/src/components/terminal-pane/pty-connection/apply-reattach-payload.ts`.

## 1. Problem and goal

Today every PTY lives in an Electron `utilityProcess` (`src/pty-host/`), and `src/main/pty/index.ts` sends `killAll`
at `will-quit`. Reopening the app therefore re-runs `claude --resume <id>` per session: login shell + ~2.4 s of
Claude startup, and whatever the agent was doing is interrupted. The snapshot restore from `claude/terminal-smooth` (now on `main`) hides the wait by
painting a saved screen (~0.5 s to first text), but the process is still new.

Goal: agent and shell processes keep running when the app quits (or its renderer reloads / crashes), and the next
launch **reattaches** to the same processes: same pid, live screen including the alternate screen and input modes,
output that happened while the app was closed, hook-driven status caught up. Target: first correct frame of a
reattached session < 150 ms after the window is ready.

Non-goals (v1): surviving logout/reboot (processes die with the login session; the existing snapshot +
`--resume` path covers that), remote/SSH hosts, Windows/Linux, launchd integration, multiple app profiles sharing
one daemon.

## 2. What Orca does, and what we take

Orca's daemon is ~550 files hardened over many releases (launchd job from a copied signed helper bundle, endpoint
ownership protocol, durable history logs, cold-restore checkpoints, login-session death watch, spawn admission,
protocol v48 with per-feature version gates). Most of that is for problems we do not have yet (Linux cgroups,
AppImage, Windows, auto-update replacing the bundle under a running daemon, multi-window remote runtimes).

We take the core shape and keep it small:

| Orca | Here (v1) |
|---|---|
| Detached `ELECTRON_RUN_AS_NODE=1` child (fallback) / launchd job (macOS default) | Detached `ELECTRON_RUN_AS_NODE=1` child only. launchd is a later option (§3.5). |
| Versioned socket `<userData>/daemon/daemon-v<N>.sock`, short `/tmp` fallback, token file, pid record | Same, minus the link/rename ownership dance (we already hold Electron's single-instance lock per profile). |
| Per-session `HeadlessEmulator` (`@xterm/headless` + serialize) → `getSnapshot()` with `rehydrateSequences` | Same idea, much smaller `HeadlessMirror` (§4). Adapted code attributed in `THIRD_PARTY_NOTICES.md`. |
| `createOrAttach`: live session → snapshot + attach; else spawn | Same, as two explicit calls `attach` / `spawn` (§5). |
| Renderer `applyReattachPayload`: clear, resize to snapshot size, write snapshot, epilogue, then live stream with a seq baseline | Same steps in `SessionTerminal` (§6). |
| Idle shutdown: no live sessions, no clients (plus a 2 min initial-adoption timeout) | Same (§7.3). |

## 3. Process model

### 3.1 Processes

```
Electron main ──(unix socket, NDJSON, token)──► tr-ptyd (ELECTRON_RUN_AS_NODE=1, detached, setsid)
   │                                                ├─ node-pty sessions (shells, claude, codex)
   │                                                ├─ HeadlessMirror per session
   └─ renderer (window.tr.pty, unchanged shape)     └─ hook socket server (§8)
```

- `tr-ptyd` is `process.execPath` (the Electron/app binary) run as plain Node with `out/main/pty-daemon.js`,
  `child_process.spawn(..., { detached: true, stdio: ['ignore', log, log] })`, then `unref()`. `cwd` = userData (a
  deleted worktree must not be its cwd). It is in its own session/process group, so quitting the app, a crash of
  main, or ⌘R in dev do not touch it. Measured here: `ELECTRON_RUN_AS_NODE=1 Electron -e "require('node-pty');
  require('@xterm/headless')"` = 0.33 s cold, 0.04 s warm.
- Electron's `runAsNode` fuse must stay enabled (it is today; electron-builder does not flip it). If it is ever
  disabled, the daemon needs a helper binary (that is the launchd/helper-bundle path).
- macOS TCC: a child spawned by the app keeps the app as its responsible process, so folder-access prompts from
  agents are still attributed to Terminal Reborn after the app quits.

### 3.2 Code layout

`src/pty-host/` becomes transport-agnostic:

- `session-host.ts` — today's `index.ts` logic (spawn, write, resize, kill, ack/flow control, batcher) as a class that
  takes an `emit(event)` callback; plus the `HeadlessMirror` per session, `attach`, `list`.
- `headless-mirror.ts` (+ test) — §4.
- `index.ts` — the utilityProcess entry, kept as the **fallback transport** (`TR_PTY_DAEMON=0`, or the daemon could not
  be launched/reached within 3 s). Behaviour then is exactly today's (sessions die with the app).
- `src/pty-daemon/entry.ts` — new rollup entry: socket server, auth, client bookkeeping, idle exit, hook server.
- `src/main/pty/daemon-client.ts` — locate / adopt / launch / reconnect; implements the same `HostTransport`
  (`post(request)`, `onEvent`, `onExit`) that the utilityProcess wrapper implements, so `src/main/pty/index.ts` keeps
  its session/owner bookkeeping and validation unchanged.

### 3.3 Endpoint, token, adoption

Files under `<userData>/daemon/` (dir 0700, files 0600):

- `daemon-v<PROTOCOL>.sock` — the socket. If the path exceeds 103 bytes (sun_path), `/tmp/tr-<uid>-ptyd-<hash12>/`
  (0700, owner checked, never chmod-repaired) — same rule as `src/main/hooks/hook-dir.ts`.
- `token` — 32 random bytes hex, created by the launcher before the first spawn, read by the daemon at start. Every
  connection's first frame is `hello {token, protocol, appVersion}`; compared with `timingSafeEqual`; wrong token or
  protocol → close.
- `daemon.json` — `{pid, protocol, appVersion, buildId, startedAt}` written by the daemon after `listen`, for logs,
  e2e cleanup and "is the old daemon still alive" checks.
- `daemon.log` — the daemon's stdout/stderr (rotated at 5 MB at start).

Startup in main (`registerPtyHandlers`, before the window loads):

1. `connect(sock)`; on success → `hello` → `ok {pid, buildId, sessions:[…]}` → **adopt**.
2. `ENOENT` / `ECONNREFUSED` → remove the dead socket file, launch a daemon, poll-connect every 25 ms for ≤ 3 s.
3. Anything else (timeout, `EPERM`) is not proof of death: do not touch the socket; fall back to the utilityProcess
   for this run and log it (Orca's "never collapse can't-tell into dead").
4. Only one launcher exists per profile (Electron single-instance lock), so no endpoint race between launchers. The
   daemon itself, on `EADDRINUSE`, probes the socket and exits if something answers.

The connection is long-lived. If it drops while the app runs (daemon crashed or was killed), main treats it exactly
like today's host crash: `ptyHostRestarted` with the lost session ids (the existing "recover" card resumes agents),
and the next spawn launches a fresh daemon with the existing backoff (`hostRestartDelay`).

### 3.4 Wire protocol

NDJSON frames over the socket, one connection per app. Requests/events are today's `HostRequest` / `HostEvent`
(`src/pty-host/protocol.ts`) plus:

- `hello` / `ok` (above), `list` → `[{id, pid, alive, exitCode?, cols, rows, title?}]`
- `attach {id}` → `attached {id, pid, seq, snapshot}` or `attach-miss {id}` (§5)
- `detach {id}` — stop streaming one session to this client (session keeps running)
- `shutdown {killSessions: true}` — kill everything and exit (the "quit and end sessions" path, tests)
- `data` events gain `seq` (UTF-16 offset of the chunk's end in the session's stream) for the replay baseline.
- `hook` / `hook-reply` (§8).

Spawn requests carry the **app's** base environment (main's `process.env`), not the daemon's: a daemon started
days ago must not hand new shells a stale `PATH`. `buildPtyEnv` already strips `ELECTRON_RUN_AS_NODE` etc.

`PROTOCOL` starts at 1. `hello`, `list` and `shutdown` are frozen across versions so a newer app can always
inventory and retire an older daemon (§9).

### 3.5 Why not launchd now

launchd buys independence from the app bundle being replaced while the daemon runs (Orca copies a signed helper into
userData for that) and a clean "service" in Activity Monitor. We have no auto-installer (updates.ts only checks), and
a manually replaced bundle keeps the daemon's already-loaded code and `pty.node` working; `spawn-helper` is re-read
from the same path, a stable tiny binary. Revisit when auto-update ships.

## 4. HeadlessMirror (per session, in the daemon)

Every PTY chunk is written to the session's batcher (to the client, if attached) **and** to a `@xterm/headless`
`Terminal` (same cols/rows as the PTY, `scrollback` = the renderer's scrollback setting capped at 5000, Unicode 11
widths like the renderer so CJK/emoji rows line up; `@xterm/headless` moves from devDependencies to dependencies,
`@xterm/addon-serialize` is already a dependency).

`snapshot()` returns:

- `data` — `SerializeAddon.serialize({ scrollback })` of normal buffer + (if active) the alternate screen, with modes
  excluded (we emit them ourselves, below). Size-capped the same way as today (2000 → 500 → 0 rows, ≤ 2 MB).
- `cols`, `rows`, `seq` — the stream position the snapshot represents.
- `rehydrate` — the input/screen modes the program set, read from the headless terminal, as escape sequences:
  `?1049h` (alt screen, emitted before the frame), `?2004h` bracketed paste, `?1h` application cursor, `?25l` hidden
  cursor, `?1004h` focus reporting (Claude Code uses it), mouse tracking `?1000h/?1002h/?1003h` and its encoding
  `?1006h`, `?2026` released. The public `IModes` covers all but the mouse encoding; for that we read xterm's
  `_core.coreMouseService.activeEncoding` and, if unavailable, assume SGR when tracking is on (every TUI we host
  uses SGR). Kitty keyboard flags only if the renderer's xterm has kitty keyboard enabled (it does not today).
- `title` — last OSC 0/2 title; the renderer re-emits it so the title-based status rules (`session-state-machine.ts`)
  see the current title immediately.
- `pendingEscape` — an incomplete escape sequence at the cut, written last so the next live chunk completes it
  (Orca bug "E"; rare, cheap to carry).

**Consistent cut.** xterm parses asynchronously. On `attach`, the daemon (1) starts queueing this session's outgoing
data for the client, (2) writes an empty chunk to the headless terminal with a callback; write callbacks fire in FIFO
order right after their chunk is parsed, so inside it the buffer reflects exactly the stream up to `seq`, (3)
serializes, sends `attached`, then flushes the queue. No private `writeSync` needed.

Cost: every byte is parsed twice (daemon + renderer). Orca ships with the same trade; the headless parser has no
renderer and is cheap. Measured during implementation with a `cat` of a 50 MB file and a long Claude session; budget:
daemon CPU ≤ 30 % of the renderer's for the same stream.

Flow control: the existing watermark pause applies only while a client is attached and acking. With no client the
daemon never pauses the PTY (an agent must not block because the app is closed); output goes to the mirror only.

## 5. Attach vs spawn

Renderer-facing API (`TrApi`, additive):

- `pty.attach(sessionId) → {pid, seq, snapshot} | null` — new.
- `pty.spawn(options)` — unchanged; still replaces an existing process with that id (explicit restart).
- `pty.live() → [{sessionId, pid, alive, exitCode?}]` — new; what the daemon holds, for boot.

Main validates and enforces ownership as today; `attach` makes the calling window the session's owner.

## 6. Renderer reattach

Boot (`useSessionStartup` / workspace load): call `pty.live()` once. A session the daemon holds alive gets phase
`running` (status `idle` until hook replay, §8) instead of `not-started`, so the auto-start-on-view path never
`--resume`s a process that is still running. A session the daemon holds as exited gets phase `exited` with its code.

Live sessions are attached **at boot, all of them**, not only the viewed one, because status, notifications and the
Dock badge need their output and hook events. (Their panes are created hidden, like an already-visited session today.)

`SessionTerminal.start()` becomes:

1. `await surface.whenOpen()`; subscribe `onData` first and buffer chunks.
2. `const live = await pty.attach(id)`.
3. **Hit** → write `\x1b[?2026l\x1b[0m\x1b[2J\x1b[3J\x1b[H`, resize the xterm to the snapshot's cols/rows without
   forwarding the resize to the PTY, write `snapshot.data`, `rehydrate`, the OSC title, `pendingEscape`; then drop
   buffered chunks whose `seq` ≤ `snapshot.seq` (slice a straddling one), write the rest, go live. Then fit to the
   container; if the size differs the normal `resize` reaches the PTY and the program repaints (SIGWINCH). The disk
   snapshot is not used.
4. **Miss** → today's cold path unchanged: paint the disk snapshot (`restorePayload`, display-only, no modes), then
   `spawn` with `resumeAgentSessionId`.

`dispose()` (session closed, project removed) still kills. Window unload, renderer crash and reload no longer kill:
`src/main/pty/index.ts` changes `owner.once('destroyed', killOwnedBy)` to *detach* owned sessions.

## 7. Quit semantics

### 7.1 Today

`before-quit` → quit guard (`src/main/quit.ts`) confirms when sessions are running/waiting ("退出会中断它们"), then
`will-quit` kills everything. The PRD's reason for the dialog is that quitting interrupts agents.

### 7.2 Proposed

- **⌘Q / menu / Dock "退出"**: the app quits, sessions keep running in the daemon. No confirmation (nothing is
  interrupted any more). `will-quit` closes the daemon connection instead of `killAll`. The renderer still saves disk
  snapshots on unload (cold path after a reboot).
- **New app-menu item "退出并结束所有会话" (⌥⌘Q)**: the old behaviour, with the old confirmation when sessions are
  active: `shutdown {killSessions: true}`, then quit.
- **Logout / shutdown** (`powerMonitor 'shutdown'`): plain quit, never a dialog; the OS ends the daemon and agents.
- Trade-off to accept: while the app is closed there are no notifications or Dock badge for an agent that needs
  you. On relaunch the replayed hook journal (§8) brings those sessions straight to "等你处理".

PRD copy to update: `quitConfirmation` moves to the new menu item; the M6 line is satisfied by the daemon (the
`--resume` path remains the reboot fallback).

### 7.3 When the daemon exits

- No live sessions **and** no connected client for 10 s → it removes nothing but its socket and pid record, and
  exits. (A quit with only exited sessions therefore leaves no process behind.)
- Launched but never adopted within 2 min (the app died during startup) → exits if it has no live sessions.
- `shutdown` request.
- Exited sessions are kept as tombstones (exit code + final snapshot) while the daemon lives, so a reopened app shows
  the last screen and "[进程已退出，退出码 N]" instead of silently resuming. If the daemon idle-exits meanwhile, the
  session falls to the cold path, which is today's behaviour.

## 8. Hooks

Today the hook socket and the `--settings` file live in `<userData>/hooks/<app-pid>/`, the token is per app run, and
stale dirs are swept. An agent keeps `TR_HOOK_SOCK` / `TR_HOOK_TOKEN` and its `--settings` path for life, so after a
restart its hooks would hit a dead socket (the relay then exits 0 silently) and its settings file would be swept.

**Proposed: the daemon owns the hook endpoint; main keeps the semantics.**

- The hook server (`src/main/hooks/server.ts`, Electron-free already) and the supervisor's self-check run in the
  daemon at a stable path `<userData>/daemon/hooks/` with a token persisted next to the daemon token. The Claude
  settings file and Codex overrides point at the same stable `tr-hook.sh` path as today.
- Each hook request is relayed to the attached client as `hook {sessionId, event, agent, payload}`; main runs the
  existing `HookBridge` / `normalize` and answers `hook-reply {body}` (with `holdPermissions: false` that is
  immediate; a 5 s relay timeout answers empty).
- No client attached → answered empty at once (the agent is never slowed), and the event is appended to that
  session's **journal** (last 64 events, payloads over 64 KB replaced by `null`; status only needs event kinds and
  small fields). On attach, main drains the journal through the bridge before live events, so status, the current
  conversation id (`SessionStart` after `/clear`) and `needs_you` catch up.
- `src/main/hooks/hook-dir.ts`'s per-pid layout and sweep stay for the utilityProcess fallback only.

Alternative considered: keep the server in main but at a stable path with a persisted token. Much smaller change,
but every event while the app is closed is lost, so a turn that ended (or a permission prompt that appeared) while
the app was closed shows the wrong status until the next event. Title heuristics recover some of it, not reliably.

## 9. Versions and upgrades

- Same `PROTOCOL` → adopt, even across app versions. `buildId` mismatch is only logged (in dev, where the daemon
  bundle changes on every edit, a mismatch retires it as below so code changes take effect).
- Different `PROTOCOL` (a `daemon-v<other>.sock` exists): the frozen `hello`/`list` inventory it; the app asks it to
  snapshot to disk and `shutdown {killSessions: true}`, then cold-restores those sessions with `--resume`. One
  interruption per protocol bump, visible as the existing restore path. Protocol bumps should be rare.

## 10. Snapshot restore (from `claude/terminal-smooth`, now on `main`)

Its pieces stay as the **cold path** (daemon gone: reboot,
logout, daemon crash, protocol retirement): `snapshot-payload.ts` (display-only, alt frame drawn into the normal
buffer because the new process redraws), `terminal-snapshot-file.ts` / `terminal-snapshots.ts` (disk store), and the
renderer's quiet-time saves. Change: the renderer also saves after a reattach, and the daemon refreshes the disk
snapshot of a session on 30 s of quiet while no client is attached, so the cold path after a reboot shows the latest
screen even for agents that ran for hours with the app closed. Same file format; one writer at a time (client
attached → renderer, else daemon).

## 11. Security

Socket and token files 0600 in a 0700 dir owned by the user (checked with `lstat`, symlinks refused); token on every
connection; daemon validates every request field (reuses `src/main/pty/validate.ts` shapes); `contextIsolation` /
`sandbox` unchanged; the renderer still only reaches the daemon through main. The daemon never writes to the user's
agent configs.

## 12. Tests

- Vitest: `HeadlessMirror` (alt screen + modes round-trip into a second headless terminal reproduces the same buffer
  and `modes`; consistent cut under concurrent writes; pending escape), protocol framing, journal bounds, client
  adoption decisions (connect result → adopt / launch / fallback), idle-exit timer.
- e2e `e2e/pty-daemon.spec.ts`: open a shell session, `echo $$` → pid P and a mark; `app.close()`; the daemon pid is
  still alive and `ps -p P` is still alive; relaunch on the same profile; the screen shows the mark in < 500 ms
  without a new spawn; `echo $$` prints P again. Second test: a full-screen program (`vim` or a small alt-screen
  script) is redrawn with the alt screen active after relaunch, and a key reaches it. Cleanup: `shutdown
  {killSessions}` via `daemon.json` in `afterAll`.
- All other e2e specs run with `TR_KILL_SESSIONS_ON_QUIT=1` set by `e2e/launch.ts` so no daemons outlive a test.

## 13. Implementation order

1. `src/pty-host/` refactor into `session-host.ts` + utility entry (no behaviour change, tests green).
2. `HeadlessMirror` + attach/seq in the session host.
3. `src/pty-daemon/entry.ts` + `src/main/pty/daemon-client.ts` (launch/adopt/fallback, host-crash path).
4. Renderer: `pty.live` / `pty.attach`, boot phases, reattach replay, destroyed → detach.
5. Quit semantics + menu item (+ PRD copy).
6. Hooks relay + journal.
7. Daemon-side disk snapshots, version retirement, e2e.

Files outside `pty-terminal` ownership that this touches (called out in commits): `src/shared/ipc.ts` (additive),
`src/main/quit.ts`, `src/main/menu-spec.ts`, `src/shared/lifecycle.ts`, `src/main/hooks/index.ts`,
`src/renderer/state/session-start*.ts`, `electron.vite.config.ts`, `package.json`, `docs/PRD.md`.

## 14. Decisions (2026-10-16)

1. Quit: ⌘Q keeps agents running with no dialog; "退出并结束所有会话…" (⌥⌘Q) ends them (confirmation while any is
   active). No setting.
2. Hooks: the daemon owns the hook endpoint and journals missed events (§8).

## 15. What shipped, and what did not (yet)

Shipped as designed: §3 (detached daemon, adopt/launch/fallback, versioned socket, token, `daemon.json`, log),
§4 (HeadlessMirror with mode rehydration and a consistent cut), §5–6 (`pty.live` / `pty.attach`, all live sessions
attached at boot, reload/crash detach instead of kill), §7 (quit semantics, idle exit after 10 s), §8 (daemon hook
socket under `<userData>/daemon/hooks`, relay, 64-entry journal replayed with original timestamps), §9 (other
protocol versions are retired), §12 (unit tests, `e2e/pty-daemon.spec.ts`, other specs quit with
`TR_KILL_SESSIONS_ON_QUIT=1`).

Not yet:
- §10 daemon-side refresh of the disk snapshot while no app is attached (the renderer still saves on quiet output and
  on unload, so a reboot shows the screen as of the last quit).
- `pendingEscape` from §4 (an escape sequence cut in half at the attach point renders as text once).
- Startup time and CPU numbers from §4's budget have not been measured on a long Claude session yet; the e2e
  asserts first reattached frame < 1.5 s after the window loads.
