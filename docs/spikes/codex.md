# Spike: Codex adapter (hooks, trust, approvals, titles)

Date: 2026-10-14 · Platform: macOS (Darwin 25.3, Apple Silicon) · Codex CLI **0.142.5** · docs read: https://developers.openai.com/codex/hooks (redirects to learn.chatgpt.com/docs/hooks) and the open-source `codex-rs/hooks` (`engine/discovery.rs`).

Scripts (all under `scripts/spikes/`):

| File | What |
|---|---|
| `40-codex-hooks-list.mjs` | Starts `codex app-server -c …`, asks `hooks/list` for a cwd, prints every hook with `source`, `trustStatus`, `currentHash`. |
| `41-codex-hooks-lab.mjs` | The real Codex TUI in a PTY (`/tmp/tr-codex-lab`), hooks injected per launch, capture server on a Unix socket, the production relay `resources/hooks/tr-hook.sh`. Scenarios: `startup`, `ok`, `slash`, `approve`, `ctrlc`, `busykey`, `interrupt`. |
| `codex-mock-provider.mjs` (+ `.d.mts`) | A tiny local Responses API that scripts the model: `RUN: <cmd>`, `REPLY: <text>`, `CALL: <tool> <json>`, `HANG:`. |

Fixtures built from these captures: `src/main/hooks/codex-fixtures.ts` (scrubbed).

## 0. How the evidence was gathered (read this first)

**The user's model provider (`agentrouter.org`, group `default`) answered `503 无可用渠道` for every model I tried** (`gpt-5.6-sol` = the configured one, `gpt-5.5`, `gpt-5`, `gpt-5.1-codex`; the earlier M1 spike never got a completed turn either). So no real model turn ever completed. What I did instead:

- **Real turns used: 4**, all failed with 503 before any tool call. They did prove hook delivery on a real provider path: `SessionStart` + `UserPromptSubmit` were delivered for the 503 turns, and *no* `Stop` is sent when the request fails (relevant for §5).
- Everything else ran the **real Codex 0.142.5 binary** (real TUI, real sandbox/approval logic, real hook engine, real hook processes through `tr-hook.sh`) against `codex-mock-provider.mjs`, a local Responses-API stand-in that returns scripted tool calls. It is pointed at per launch with `-c model_provider="mock" -c 'model_providers.mock={…base_url="http://127.0.0.1:PORT/v1"…requires_openai_auth=false}'` (nothing written to `~/.codex`). Only the *model* is fake. Payloads in §1 therefore contain whatever tool arguments my mock chose, in Codex's real envelope.
- **Not verified because of that:** anything that depends on a real model's behaviour (how often a real model triggers approvals, `request_user_input` use by a real model in Plan mode, long turns, token/usage hooks).

Side effects on the user's machine: nothing in `~/.codex/config.toml`, `hooks.json`, `rules/` or `auth.json` was written (mtimes checked after the work). Codex wrote its own runtime artifacts as in any normal use (`~/.codex/sessions/2026/10/14/rollout-*.jsonl`, `history.jsonl`, the sqlite logs) for the lab runs; the e2e uses a throw-away `CODEX_HOME`. `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_*`, `ORCA_*` were stripped from every child env. One fixed lab dir: `/tmp/tr-codex-lab` (a git repo), trusted per launch with `-c 'projects={…}'`.

## 1. Hook events and payloads (research question 1)

`codex features list` shows `hooks` stable and **on by default**. `hooks/list` (app-server schema) knows ten events in 0.142.5: `preToolUse, permissionRequest, postToolUse, preCompact, postCompact, sessionStart, userPromptSubmit, subagentStart, subagentStop, stop`. The docs page also lists `SessionEnd` and `Interrupt`; **0.142.5 ignores them** (an unknown event name in `-c hooks.X=…` is silently dropped, no warning; verified), so there is **no end-of-session and no interrupt signal**.

Common fields: `session_id` (a Codex thread id, not ours), `cwd`, `hook_event_name`, `model`, `permission_mode` (`default`… it stayed `default` in Plan mode too); turn-scoped events also `turn_id`. `transcript_path` appears on lifecycle events (a rollout file under `~/.codex/sessions`).

Captured (scrubbed; full set in `codex-fixtures.ts`):

```jsonc
// SessionStart: fires with the FIRST prompt of a thread, not at TUI start (nothing arrives while Codex sits at its empty prompt)
{ "hook_event_name": "SessionStart", "source": "startup", "model": "gpt-5.5", "permission_mode": "default" }
// UserPromptSubmit
{ "hook_event_name": "UserPromptSubmit", "turn_id": "…", "prompt": "Reply with only the word OK." }
// PreToolUse — shell tool is "Bash" with tool_input.command (Codex's exec_command); tool_use_id = the model's call id
{ "hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": { "command": "echo x > ran.txt" }, "tool_use_id": "call_1" }
// PermissionRequest — NO tool_use_id, no permission_suggestions; tool_input.description is documented but was absent
{ "hook_event_name": "PermissionRequest", "tool_name": "Bash", "tool_input": { "command": "echo x > ran.txt" } }
// PostToolUse — tool_response is a plain STRING (stdout/stderr for Bash, "Exit code: 0 …" text for apply_patch); no exit code or success flag
{ "hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_input": { "command": "…" }, "tool_response": "", "tool_use_id": "call_1" }
// apply_patch: tool_name "apply_patch", tool_input.command = the whole patch text ("*** Begin Patch\n*** Add File: x\n…")
// Stop
{ "hook_event_name": "Stop", "turn_id": "…", "stop_hook_active": false, "last_assistant_message": "DONE" }
// request_user_input (Plan mode only): PreToolUse/PostToolUse, tool_input = { questions: [{ id, header, question, options: [{ label, description }] }] }
//   PostToolUse tool_response = '{"answers":{"q1":{"answers":["A"]}}}'
```

Behaviours that shaped the adapter:

- **There is an approval hook that returns a decision.** `PermissionRequest` runs only when Codex is *about to ask for approval*; commands that need none (e.g. `ls` under `-a untrusted`, writes inside a `workspace-write` project) raise no PermissionRequest. Output (verified):
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` runs the tool ("Ran …", PostToolUse follows); `{"behavior":"deny","message":"…"}` makes the tool fail for the model with `Rejected("…")` and **the turn continues** and ends with a normal `Stop`; an empty body = no opinion (Codex then shows its own dialog). Per the docs `updatedInput`, `updatedPermissions` and `interrupt` are "reserved and fail closed" for Codex, so the Codex decision body is the minimal one (`decisionBody(…, 'codex')`). Any `deny` wins, an `allow` suppresses the dialog.
- **While the hook is pending Codex does NOT show its approval dialog** ("Running 2 PermissionRequest hooks" is all the TUI says, with a live "Working" timer). This is the opposite of Claude, where the TUI dialog is always present underneath. Consequences: the app's prompt is the *only* way to answer until the 120 s hold times out (then the empty body makes Codex show its dialog, §4); a GUI that is closed/unseen delays Codex by up to 120 s; the user's own `~/.codex/hooks.json` hooks (Orca's) run concurrently and their empty answers did not shadow ours.
- No `PostToolUseFailure`; no `Notification`; no `StopFailure`. A failed model request (503) and an interrupted turn (Esc / Ctrl+C / "No" in the dialog) emit **no `Stop`** at all.
- `request_user_input` is "unavailable in Default mode" (the tool result says so); in Plan mode (`/plan`) a `PreToolUse` fires, the TUI shows a question menu, and **no PermissionRequest** is raised for it.

## 2. Supplying hooks per launch without touching `~/.codex` (question 2)

| Option | Result |
|---|---|
| **`-c hooks.<Event>=[{hooks=[{type="command",command="…",timeout=N}]}]`** | **Works, chosen.** Hooks supplied this way form their own config layer, `source: "sessionFlags"`, key `/<session-flags>/config.toml:<event>:<group>:<handler>`. They run **in addition to** the user's `~/.codex/hooks.json` hooks and to inline `[hooks]` tables in the user's `config.toml` (verified with a temp `CODEX_HOME` holding an inline `[[hooks.Stop]]`: both listed). Same flag mechanism as the existing per-launch `projects={…}` trust. |
| `CODEX_HOME=<tmp dir>` | Works technically but is invasive: a fresh home is **not logged in** (`codex login status` → "Not logged in", verified), has no config/projects/history/sessions, and symlinking `auth.json`/`config.toml` would let Codex refresh tokens through the link, i.e. write the global files. Rejected for the product (used only by the e2e, where it isolates the test from the user's setup). |
| `-p <profile>` / `$CODEX_HOME/<name>.config.toml` | Needs a file inside `~/.codex`. Rejected (global write). |
| Repo-local `<repo>/.codex/hooks.json` / `config.toml` | Writes into the user's repository and only loads when the project layer is trusted. Rejected. |
| `resources/bin/codex` wrapper (PRD §6.2) | Not needed: the app builds the agent argv itself (`agentArgv`), so the overrides go straight on the command line. A wrapper would only matter for `codex` typed by hand in a *shell* session. |

The hook command is the existing relay: `/bin/sh '<tr-hook.sh>' <Event> codex` with `TR_SESSION_ID / TR_HOOK_SOCK / TR_HOOK_TOKEN` inherited from the PTY env (Codex passes the env to hook commands; verified). Events configured: `SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop`; only PermissionRequest gets the long (130 s) timeout. Latency (capture server clock): `UserPromptSubmit` arrived ~100 ms after the Enter byte was written (includes the first-prompt `SessionStart`, 11 ms before it); `PermissionRequest` followed `PreToolUse` by ~21 ms. The hook runs also show up in the TUI as "Running N Stop hooks" for a moment.

## 3. Hook trust (question 3) — decided without writing `~/.codex`, no broad bypass

Codex runs a non-managed hook only if the hook's current hash equals `hooks.state."<key>".trusted_hash` (`HookTrustStatus`: `trusted | untrusted | modified | managed`; a session-flag hook starts `untrusted`, so it is *skipped*). Findings:

1. `--dangerously-bypass-hook-trust` ("run enabled hooks without requiring persisted hook trust for this invocation") bypasses trust for **every** non-managed enabled hook of the launch, i.e. also hooks in a repo's `.codex/` layer and in plugins the user never reviewed. A malicious repo could ship a hook that then runs unreviewed. That is the "broad trust bypass" the brief tells us not to choose.
2. **`hooks.state` can itself be supplied with `-c`** — it is ordinary config, merged with the user's own `[hooks.state]` (their Orca hooks stayed `trusted`). So we pin exactly our hashes for this launch:
   `-c 'hooks.state={"/<session-flags>/config.toml:stop:0:0"={trusted_hash="sha256:…"}}'` — one entry per event. Verified: `trustStatus` flips `untrusted → trusted` for the pinned entries only; other hooks are unaffected; the hooks then fire in the real TUI.
3. The hash is not computed by us (Codex hashes a normalised TOML identity of event + matcher + handler, `engine/discovery.rs::hook_hash`; re-implementing it would break silently on a Codex update). Instead `probeCodexHookHashes` starts `codex app-server -c <the same hooks.*>` in the user's login shell, sends `initialize` + `hooks/list`, and reads `currentHash` of the `sessionFlags` entries. ~0.3–0.5 s, **once per app run** (cached on the first Codex launch; a failed probe is not cached), no thread is started so it costs no model turn. If the probe fails or does not cover all six events, Codex is launched **without** hooks (`prepareAgentLaunch` returns null) and the sidebar falls back to titles (§5).

Trade-offs of the chosen path: trust is pinned to our exact command string (script path included), so a hook edited by someone else would be `modified` and skipped — strictly safer than bypassing. Costs: one extra short process on the first Codex launch; depends on the app-server `hooks/list` method (a stable, documented part of the app-server protocol, it also appears in the generated JSON schema). **No user decision is needed**; if the user prefers not to use `-c hooks.state`, the only alternatives are the bypass flag (rejected above) or asking the user to `/hooks` → trust once per hook (writes `~/.codex/config.toml`).

## 4. Approvals and questions in the TUI, keystrokes (question 4)

Observed in 0.142.5 (after releasing the hold with an empty body so Codex shows its own dialog; mock-driven):

```
  Would you like to run the following command?          (apply_patch: "Would you like to make the following edits?")
  $ echo codex-lab-ran > /tmp/tr-codex-lab/ran.txt
› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with `…` (p)     (apply_patch: "…for these files (a)")
  3. No, and tell Codex what to do differently (esc)
  Press enter to confirm or esc to cancel
```

| Key | Result (verified) |
|---|---|
| `y` or `1` | Runs the command; PostToolUse, the model gets the output, the turn ends with `Stop` |
| `Esc` or `3` | "✗ You canceled the request" + "Conversation interrupted - tell the model what to do differently": the **turn is aborted** (no PostToolUse, no Stop). Different from a hook deny, which lets the model continue |
| `p` / `a` | "Don't ask again" writes an exec-policy rule into `~/.codex/rules` — never sent by the app |

`planCodexApproval(decision)` (`src/shared/codex-keys.ts`) returns the steps: allow-once → `y`; deny → `Esc`; allow-always → same as allow-once (and `canAllowAlways` is always false for Codex because the normaliser offers no suggestions). `detectCodexApproval(screen)` recognises the dialog from the buffer (needs the question line **and** the `Yes, proceed (y)` row).

Questions (`request_user_input`, Plan mode): the TUI shows `Question 1/N (N unanswered)` with numbered options plus a last `N+1. None of the above` (notes via Tab). **A digit selects and submits the current question and the TUI moves on by itself; the digit on the last question submits the whole call — there is no review screen** (unlike Claude, which needs an extra Enter). Verified with 1 and 2 questions (`"13"` answered A then E; an extra `\r` after the digit is harmless). `planCodexQuestionAnswer` has `planQuestionAnswer`'s signature; the prompt bar picks it for `codex` sessions (`src/renderer/prompt-bar/answer.ts`). Free text is not supported (it picks "None of the above").

## 5. Title / OSC signals (question 5)

OSC sequences seen from the whole TUI session: `OSC 10;?` and `OSC 11;?` (colour queries) and **`OSC 0`** titles. **No OSC 7501 and no OSC 9/777/133** appeared in startup, idle, busy, approval, question or interrupt flows.

Title timeline (spinner frames collapsed):

| TUI state | `OSC 0` title |
|---|---|
| idle / finished | `<dir>` (no prefix), e.g. `tr-codex-lab` |
| startup (MCP servers starting) and every working turn, including while a PermissionRequest hook is held | `⠋ <dir>` … braille spinner `⠀–⣿`, animating |
| **Codex's own approval/question dialog is up** | **`[ ! ] Action Required | <dir>` / `[ . ] Action Required | <dir>`, alternating about once a second** |
| after Esc / Ctrl+C / "No" / 503 | `<dir>` (idle) with **no hook event** |

State machine rules (`session-state-machine.ts`, Codex sessions only; Claude behaviour and tests unchanged):

- busy title after a quiet period from `idle` → `running` (flag `titleRun`); the title going idle ends *that* run immediately (covers the MCP-startup spinner), a hook event first makes hooks authoritative.
- `Action Required` title → `needs_you` (flag `titleAction`) even without a hook (hold timed out and Codex's own dialog is showing); the spinner returning → `running`; the title going idle → `idle`.
- **Heal:** an idle title with no hook event for `CODEX_IDLE_HEAL_MS` (4 s) turns `running` / `needs_you` into `idle`. This is what ends turns that Codex never closes with a Stop (interrupt, 503, deny-by-Esc). 4 s is safe because the spinner starts ~immediately with the prompt and runs for the whole turn, including held approvals.

## 6. Ctrl+C on an empty Codex prompt (question 6)

Re-verified on 0.142.5: **one Ctrl+C on an empty prompt starts quitting** (the composer disappears at once; the process exits on the next Ctrl+C or when it finishes shutting down). While a turn is running, **Ctrl+C and Esc both interrupt the turn** ("Conversation interrupted") and do not quit.

Recommendation for the composer (`src/renderer/composer/`, not changed here): for `codex` sessions, forward an empty-composer Ctrl+C only when the session status is `running` / `needs_you` (it interrupts); when the agent is idle, don't forward — show a one-line confirmation ("Codex 会退出，确定？ ⏎") or map it to nothing. Esc is always safe to forward (it only interrupts a turn / closes dialogs). Claude's Ctrl+C needs two presses, so only Codex needs the guard.

## 7. What was implemented

- `src/main/hooks/normalize.ts`: `normalizeHook('codex', …)` → `AgentEvent` / permission draft / questions. Codex tools are mapped onto Claude's vocabulary so the rest stays agent-agnostic: shell → `Bash {command}` (extra `description` dropped so the PermissionRequest and PostToolUse of one call match), `apply_patch` → `Write`/`Edit {file_path, files}` (patch text dropped), `request_user_input` → `AskUserQuestion`. `tool-end` is always `ok` (no failure flag in the payload). Existing test "codex payloads are ignored until M3" replaced (it asserted the old stub).
- `src/main/hooks/codex-config.ts`, `codex-probe.ts`: the `-c` overrides, the trust pin, the `hooks/list` probe (testable over streams), graceful degradation to "no hooks".
- `permission-registry.ts` / `bridge.ts`: `decisionBody(decision, suggestions, agent)`; Codex bodies never contain `interrupt` / `updatedPermissions`.
- `src/main/hooks/index.ts`, `src/main/pty/index.ts`, `src/pty-host/{protocol,index}.ts`: Codex launches get the TR_* env and `codexConfig`; `agentArgv(…, { codexConfig })` appends one `-c` per value.
- `src/shared/codex-keys.ts`, `src/renderer/prompt-bar/answer.ts`: approval and question key planners (§4).
- `src/shared/session-state-machine.ts`: Codex title rules (§5).
- Tests: `codex-normalize`, `codex-config` (+ probe over fake streams), `codex-bridge`, `codex-keys`, state-machine and agent-launch cases; `e2e/codex.spec.ts` (opt-in, below).

`e2e/codex.spec.ts` (`TR_E2E_AGENTS=codex npm run test:e2e -- codex`, ~17 s): real Codex in the app against the mock model with a throw-away `CODEX_HOME` — hooks delivered per launch (checked in the process list: `hooks.state=` present, no bypass flag), status goes `needs_you` while the request is held (and Codex shows no dialog), `respondPermission('allow-once')` runs the command and resolves the prompt as `gui`, deny lets the turn finish, and Esc in the terminal heals the status and the stale prompt is withdrawn by the next turn. `TR_E2E_CODEX_REAL=1` runs the first two tests against the user's own provider instead (2 short turns; blocked by the 503s here, so unverified).

## 8. Known gaps / not verified

- Real-model behaviour (see §0). The mock only emits what I script; real Codex models may call `apply_patch`/MCP/`update_plan` with other shapes (the normaliser passes unknown tools through).
- Stale GUI prompt after an interrupt: Codex sends no event when Esc cancels a turn, so a held prompt stays in the prompt bar until the next `UserPromptSubmit` (or the 120 s timeout). The state machine already heals the *status*; the integrator may withdraw the prompt when a Codex session leaves `needs_you` without a prompt resolution.
- Parallel tool calls needing approval at once supersede each other (same limitation as Claude); with Codex the superseded request falls back to a dialog that only appears after the newer hook finishes.
- `request_user_input` only exists in Plan mode, and its "other" free text is unsupported.
- The first Codex launch after starting the app waits for the probe (~0.5 s measured from a script; not timed inside the packaged app). `process.env.SHELL` is used to run it; a login shell whose rc files print to stdout is tolerated (non-JSON lines are skipped), one that hangs is cut off after 10 s and Codex then starts without hooks.
- Codex versions other than 0.142.5: the key format `/<session-flags>/config.toml:<event>:0:0` is read from the probe, not hard-coded, except that `coversAllEvents` expects the `:<snake_case_event>:0:0` suffix.
