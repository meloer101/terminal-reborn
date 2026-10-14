# Spike: Claude Code hooks bridge

Date: 2026-10-14 · Platform: macOS (Darwin 25.3, Apple Silicon) · Claude Code **2.1.299** (the brief said 2.1.296; the installed binary had updated) · logged in via claude.ai.

Scripts: `scripts/spikes/30-hooks-lab.mjs` (real CLI in a PTY + capture server on a Unix socket + the production relay script; `PERM_MODE`, `ACT`, `CLAUDE_ARGS` env switches), `scripts/spikes/30-dump.mjs` (pretty-prints a capture).
Fixtures built from these captures: `src/main/hooks/fixtures.ts` (scrubbed of personal paths and ids).

**Budget and side effects**

- Real Claude turns used: **16** of 25 (12 in spike runs, 2 in the e2e's single real run, 2 in the "allow always" run; the `--settings` experiment needed none). One fixed lab dir, `/tmp/tr-hooks-lab` (a git repo), for everything. `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_*`, `ORCA_*` were stripped from every child env.
- `~/.claude.json`: exactly one entry added by this track, `projects["/private/tmp/tr-hooks-lab"].hasTrustDialogAccepted = true` (accepted once). Claude's usual bookkeeping fields (`numStartups`, `tipsHistory`, caches) also changed on every launch, as they do in normal use. (`projects["/private/tmp/tr-prompt-lab"]` appeared during the same window; it belongs to another track's lab.)
- `~/.claude/settings.json` and `~/.codex/*`: **not touched**. Hooks were only ever supplied with `--settings <file>` in `$TMPDIR`.
- Inside the lab dir only: `/tmp/tr-hooks-lab/.claude/settings.local.json` = `{"permissions":{"defaultMode":"default"}}`. The user's Claude runs in "auto" mode, where harmless Bash commands never raise a PermissionRequest; the e2e needs "manual/default" mode to provoke one.

## 0. What the docs say (https://code.claude.com/docs/en/hooks, fetched 2026-10-14)

Relied on:

- Settings shape: `hooks.<Event>[] = { matcher?, hooks: [{ type: "command", command, timeout (seconds) }] }`; omitted/`"*"` matcher = all. Default command timeout 600 s; `SessionEnd` hooks share a **1.5 s** budget.
- "All matching hooks run in parallel", "hook entries merge across settings levels rather than replacing each other", identical handlers dedupe.
- Events used: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` (`error`, `is_interrupt`), `PermissionRequest`, `Notification` (`message`, `title`, `notification_type`: `permission_prompt`, `idle_prompt`, `elicitation_dialog`, …), `Stop` (`last_assistant_message`), `StopFailure` (`error` ∈ rate_limit/overloaded/authentication_failed/…, `last_assistant_message` = the API error text; output ignored), `SessionEnd`.
- PermissionRequest stdout: `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny", updatedInput?, updatedPermissions? | message?, interrupt?}}}`; `permission_suggestions[]` entries have `type` (`addRules`, `addDirectories`, `setMode`, …) and `destination` (`session`, `localSettings`, `projectSettings`, `userSettings`).
- Exit 0 + non-JSON/empty stdout = no opinion; exit 2 blocks (not honoured for PermissionRequest); other non-zero = non-blocking error.

Not in the docs, found empirically below: how the TUI dialog interacts with a pending hook, `--settings` merge semantics, trust gating, that `AskUserQuestion` raises a PermissionRequest, and that suggestions can contain `setMode`.

## 1. `--settings` merge (the M1 leftover "预研③")

Method: `claude --settings <hooks-only file> --debug-file …` in the lab; the debug log lists every hook execution per event.

| Question | Result |
|---|---|
| Does `--settings` replace the user's settings or merge? | **Merges.** For every event the log shows the user's hooks (the Orca ones in `~/.claude/settings.json`), plugin hooks (vercel, …) and ours all executing for the same event, e.g. `Stop`, `SessionStart`, `UserPromptSubmit`. |
| Do the user's `permissions` / `model` / etc. survive? | Yes (UI showed the user's model/plan; `permission_mode` followed the user's/project's settings). A hooks-only file overrides nothing else. |
| Two `--settings` flags | **The last one wins entirely; the first is dropped** (not merged). Verified: `--settings ours --settings second` ran only `second`'s SessionStart hook, ours never fired. So the launcher must emit exactly one `--settings`. The app runs plain `claude --settings <ours>` from a login shell; a user alias/function that appends its own `--settings` after expansion would silently disable our hooks. PRD §6.2's wrapper that deep-merges a user-supplied `--settings` into ours remains the proper fix (not needed for M2). |
| Does the file need to be executable / on a fixed path? | The hook `command` is a shell string. A script without the exec bit fails with **status 126 (Permission denied)** — it happened to me once. So the generated command is `/bin/sh '<script>' <Event> claude` (works even if packaging loses the bit). Paths with spaces (`Application Support`, `Terminal Reborn.app`) are shell-quoted. |
| Trust gating | **Hooks do not run before the workspace trust dialog is accepted** (`Skipping SessionEnd:other hook execution - workspace trust not accepted`; no SessionStart is delivered). In the app the first launch in a new directory therefore shows no events until the user accepts trust in the TUI; after that SessionStart fires immediately. The session-status track should treat "no hook yet" as `idle`/unknown, not an error. |

## 2. Orca coexistence

`~/.claude/settings.json` has Orca's hooks on `PermissionRequest`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SessionStart`, `Stop`, `StopFailure`, `UserPromptSubmit`, `SubagentStart/Stop`, `PostCompact`, `TeammateIdle`. Their commands are a long `sh` snippet that exits 0 immediately unless `ORCA_AGENT_HOOK_PORT/TOKEN/PANE_KEY` are set; for PermissionRequest it prints `{}` first.

- Both ran for every event; Orca's came back in ~0 ms (`success: {}`) while ours was still holding. **A PermissionRequest `{}` from Orca does not shadow our decision**: Claude waited for ours and logged `Hook PermissionRequest … returned permission …`; the TUI said "Allowed by PermissionRequest hook" / "Denied by PermissionRequest hook".
- Orca's env (`ORCA_*`) is not set in our PTYs, so its hooks stay inert there; ours need `TR_SESSION_ID/TR_HOOK_SOCK/TR_HOOK_TOKEN`, absent in Orca's panes, so ours stay inert there. No cross-talk.
- The bridge additionally rejects any request whose `session` is not a PTY it spawned (404) and any request without the per-run token (403).
- Cost: each extra hook is one more `sh`+`curl` per event; see latency.

## 3. Payload samples (Claude 2.1.299, scrubbed)

Common fields on every event: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `hook_event_name`; most also `permission_mode` (`default`/`auto`/…) and `effort`. Full samples: `src/main/hooks/fixtures.ts`.

```jsonc
// SessionStart
{ "hook_event_name": "SessionStart", "source": "startup", "model": "claude-opus-5-5" }
// UserPromptSubmit
{ "hook_event_name": "UserPromptSubmit", "permission_mode": "auto", "prompt": "Reply with only the word OK." }
// PreToolUse  (tool_use_id present)
{ "hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": { "command": "echo hooks-lab-ran > /work/project/ran.txt", "description": "Write marker text to ran.txt" }, "tool_use_id": "toolu_…" }
// PermissionRequest  (NO tool_use_id; suggestions vary per request)
{ "hook_event_name": "PermissionRequest", "tool_name": "Bash", "tool_input": { … },
  "permission_suggestions": [ { "type": "addDirectories", "directories": ["/work/project"], "destination": "session" },
                              { "type": "setMode", "mode": "acceptEdits", "destination": "session" } ] }
// PostToolUse
{ "hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_input": { … }, "tool_response": { "stdout": "", "stderr": "", "interrupted": false, … }, "tool_use_id": "toolu_…", "duration_ms": 365 }
// PostToolUseFailure
{ "hook_event_name": "PostToolUseFailure", "tool_name": "Bash", "tool_input": { … }, "error": "Exit code 1\nls: …: No such file or directory", "is_interrupt": false, "duration_ms": 364 }
// Notification (permission: 6 s after the PermissionRequest; idle: ~60 s after Stop)
{ "hook_event_name": "Notification", "message": "Claude needs your permission", "notification_type": "permission_prompt" }
{ "hook_event_name": "Notification", "message": "Claude is waiting for your input", "notification_type": "idle_prompt" }
// Stop
{ "hook_event_name": "Stop", "stop_hook_active": false, "last_assistant_message": "OK", "background_tasks": [], "session_crons": [] }
// SessionEnd  (Ctrl+C twice -> "prompt_input_exit"; killing the PTY -> "other")
{ "hook_event_name": "SessionEnd", "reason": "prompt_input_exit" }
```

AskUserQuestion:

```jsonc
// PreToolUse and PermissionRequest carry the same tool_input
{ "tool_name": "AskUserQuestion",
  "tool_input": { "questions": [ { "question": "Which option do you prefer?", "header": "Pick", "multiSelect": false,
                                   "options": [ { "label": "A", "description": "Option A" }, { "label": "B", "description": "Option B" } ] } ] } }
// PostToolUse (after the user picked "1" in the TUI): tool_input gains "answers": { "Which option do you prefer?": "A" }
```

Findings that shaped the design:

- **AskUserQuestion also fires a PermissionRequest** (no suggestions). It must not become an allow/deny prompt; the bridge answers it with an empty body immediately and exposes the question from the PreToolUse (`PendingPrompt{kind:'question'}`). No Notification was sent for the question within 2 s.
- **StopFailure** and **elicitation Notifications** could not be provoked cheaply; their handling follows the docs and is unit-tested with hand-written payloads (documented in the tests).
- In **auto mode** (the user's default) harmless Bash (`echo … > file`, `ls`, `mkdir`) raised **no PermissionRequest at all** and ran straight through; only manual/default mode asks. Users in auto mode will see the permission bar rarely; that is Claude's classifier, not a bug.
- PostToolUse payloads include the whole tool output (could be MBs). The server accepts up to 32 MB; the bridge forwards only the normalized event, never the raw payload.

## 4. TUI / hook interaction (the key empirical question)

Setup: manual mode, hook server **holding** the PermissionRequest.

| Scenario | Observed |
|---|---|
| While our hook is pending | **The TUI shows its own permission dialog at the same time** ("Do you want to proceed? 1. Yes / 2. … / 4. No"). Nothing is hidden or delayed. The hook's request is simply outstanding. |
| We answer `allow` via the hook | The dialog disappears at once, the command runs, the result line reads "Allowed by PermissionRequest hook". |
| We answer `deny` (+ message) | Dialog disappears, tool does not run ("Denied by PermissionRequest hook"); the model continues the turn and explains (no interrupt). No `PostToolUseFailure` / `PermissionDenied` event arrived for a hook deny. |
| The user answers in the TUI (key `1`) while the hook is held | Command runs (PostToolUse ~0.4 s later), the turn completes. **Claude does not kill the hook process and the HTTP connection stays open** until the session exits (then it is killed). The status line shows a cosmetic "running PermissionRequest hooks… 1/2" meanwhile. So *we* must release the hold (empty body), which we do on the matching `PostToolUse`/`PostToolUseFailure` (same tool + input), `UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd`. PermissionRequest has no `tool_use_id`, so the match is tool name + input. |
| We reply with an **empty body** (the 120 s timeout path) | The TUI dialog just stays; answering it works normally; the command runs. Safe fallback confirmed. |
| Orca's `{}` arrives first | No effect on the outcome (see §2). |
| "Allow always" (`updatedPermissions` = the offered suggestions) | Accepted without error. **But the suggestions in the real payload were `addDirectories` (session) plus `setMode acceptEdits` (session): returning them switched the live session to "accept edits on"**, and a second `mkdir` then raised no request. Decision: the bridge filters suggestions before offering "总是允许": `setMode` is dropped, and so is any `destination: userSettings` (that would write `~/.claude/settings.json`). If nothing is left, `canAllowAlways` is false. |
| Claude exits while a hook is pending | Claude kills the hook; the server sees the connection close and withdraws the prompt (`terminal`); the PTY exit then resolves anything left as `session-ended`. |

Consequences for the UI tracks: a permission prompt in the GUI is *advisory*: the TUI dialog is always present underneath, so a missed/failed GUI answer degrades to "answer it in the terminal", never a deadlock. Keys typed into the PTY (prompt-bar's number keys for questions) work as usual and are what resolves a `question` prompt; the bridge reports it as `by: 'terminal'` when the PostToolUse(AskUserQuestion) arrives, regardless of whether the keys came from our bar or the user's keyboard.

## 5. Latency

From Claude's own debug log (`Hooks: … finished with status 0 (Nms)`), i.e. time to spawn `sh` + `curl`, POST over the Unix socket, receive the 200 and exit; 8–11 samples per event:

| Event | avg | max |
|---|---|---|
| SessionStart | 75 ms | 107 ms (cold: first spawn of the run) |
| UserPromptSubmit | 19 ms | 23 ms |
| PreToolUse | 25 ms | 38 ms |
| PostToolUse | 15 ms | 24 ms |
| PostToolUseFailure | 12 ms | 12 ms |
| Stop | 23 ms | 37 ms |
| SessionEnd | within Claude's 1.5 s budget (no figure logged; all 14 runs completed) |
| PermissionRequest | = how long we hold it (by design) |

- End to end in the capture server: `UserPromptSubmit` was received ~75 ms after the Enter byte was written (includes the 150 ms-ish paste handling on the TUI side); `PermissionRequest` followed its `PreToolUse` by 27–30 ms. Comfortably inside the PRD's "≤ 1 s from hook to sidebar/notification" budget.
- Per turn overhead for Claude: two hooks per tool call (Pre + Post) of ~20 ms each, in parallel with Orca's and plugins' hooks. Not noticeable.
- `Notification(permission_prompt)` fires **~6 s after** the PermissionRequest; the PermissionRequest is the immediate signal, so "needs you" must key off it, not the Notification. `idle_prompt` fires ~60 s after `Stop`.

## 6. Decisions and limits

- Transport as briefed: `sh` + `curl --unix-socket`, no `node`. Socket in `$TMPDIR/tr-hooks-XXXXXX/hook.sock` (dir 0700, socket 0600; macOS limit 104 chars, ours ≈ 70), per-run random token in `X-TR-Token`, `TR_SESSION_ID/TR_HOOK_SOCK/TR_HOOK_TOKEN` in the agent PTY env (main overrides any renderer-supplied `TR_*`).
- Only `PermissionRequest` blocks; its relay allows 130 s, the app answers/times out at 120 s. Everything else is fire-and-forget with a 5 s curl cap and the settings file's 10 s hook timeout. Unreachable app => exit 0, no output.
- `ExitPlanMode` PermissionRequests are passed through to the TUI too (plan approval is not an allow/deny question); not verified against the real CLI.
- Codex: the normalizer is agent-aware (`HookAgent`) and returns nothing for `codex` until M3.
- Not done / known gaps: the double-`--settings` case above; hooks only exist after workspace trust; parallel tool calls that each need approval supersede each other in the GUI (the older one falls back to its TUI dialog); packaged-app path (`process.resourcesPath/hooks/tr-hook.sh`, via `extraResources`) is wired but was not exercised with a real `electron-builder` build.
