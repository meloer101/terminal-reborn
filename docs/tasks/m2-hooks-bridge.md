# Task: hooks-bridge — Claude Code hooks → normalized agent signals

Milestone M2 · PRD §3, §4 F3 (权限确认), §6.2 · Branch/worktree: `hooks-bridge`

## Goal
Every Claude session the app launches reports its lifecycle to the app through hooks injected **per launch** (never via `~/.claude/settings.json`). Main normalizes hook payloads into `AgentEvent` / `PendingPrompt` (`src/shared/agent-events.ts`) and pushes them to the renderer over the channels in `src/shared/ipc.ts` (`agentEvent`, `agentPrompt`, `agentPromptResolved`). Permission requests block until the UI answers (`agentRespondPermission`) or time out.

## You own
- `src/main/hooks/` (new): hook server, payload normalization, pending-permission registry; register from `src/main/index.ts` with one line.
- `resources/hooks/` (new): the hook command script(s). Add it to `electron-builder.yml` `extraResources`, and resolve the path for dev vs packaged.
- `src/shared/agent-launch.ts` (+ test): add the per-launch `--settings` injection for Claude.
- `src/main/pty/` — minimal change only: inject the hook env vars (below) into agent sessions' PTY env.
- `docs/spikes/hooks.md` (new).
Don't touch renderer code; the renderer side is other tracks.

## Design (recommended — deviate only with evidence)
- **Transport:** main listens on a Unix socket in the app's temp/userData dir with Node `http`. Hook command = a POSIX `sh` script that pipes stdin to `curl -sS --unix-socket "$TR_HOOK_SOCK" -H "X-TR-Token: $TR_HOOK_TOKEN" --data-binary @- "http://tr/hook/$EVENT?session=$TR_SESSION_ID"` and prints the response body (that's how a PermissionRequest decision reaches Claude). No dependency on the user's `node`. If the socket is down, exit 0 quickly with empty output so the agent is never blocked by our absence.
- **Env per agent PTY:** `TR_SESSION_ID`, `TR_HOOK_SOCK`, `TR_HOOK_TOKEN` (random per app run; reject requests without it).
- **Settings injection:** generate one settings JSON (hooks only) per app run; Claude is launched as `claude --settings <file>`. Verify `--settings` *merges* with the user's own settings/hooks (it must not replace them) and how it coexists with the Orca hooks already in `~/.claude/settings.json` — this is the M1 leftover "预研③". Record findings in `docs/spikes/hooks.md`.
- **Events to hook (Claude Code 2.1.296):** SessionStart, UserPromptSubmit, PreToolUse, PostToolUse (+ failure variant if present), PermissionRequest, Notification, Stop, StopFailure (if present), SessionEnd. Check the current hook docs (https://code.claude.com/docs/en/hooks) for exact input/output schemas before coding; note any field you rely on.
- **Normalization (pure, tested):** raw payload → `AgentEvent`; AskUserQuestion PreToolUse also produces a `PendingPrompt{kind:'question'}` (parse `tool_input.questions`); Notification messages classified via `/permission|approval/i` etc.; one-line `summary` for permission prompts (Chinese: "运行 …", "编辑 …", "写入 …", "抓取 …").
- **Blocking permissions:** PermissionRequest holds the HTTP response, emits `PendingPrompt{kind:'permission'}`; `respondPermission` → return Claude's decision JSON (`allow` / `deny`; "allow-always" applies the offered permission suggestion). Timeout 120 s → empty response (TUI prompt takes over) and emit resolution `timeout`. If a later event for the same session shows the TUI prompt was answered directly (PostToolUse / UserPromptSubmit / Stop), release the hold and emit resolution `terminal`. Session PTY exit → resolve `session-ended`. Find out empirically whether the TUI shows its own dialog while our hook is pending and document how the two interact.
- Codex hooks are M3 — keep the normalizer agent-aware (`HookAgent`) but implement Claude only.

## Verification with the real CLI
Use one fixed lab directory (e.g. `/tmp/tr-hooks-lab`, a git repo) for every run so at most one trust entry is added to `~/.claude.json`; report it. Strip `CLAUDECODE` / `CLAUDE_CODE_*` from the child env. Budget: **≤ 25 short Claude turns** ("reply OK", "run `echo hi` with Bash" to trigger a permission, "ask me a question with AskUserQuestion offering A/B"). Never modify the user's global configs.

## Done when
- Unit tests: normalization for every event type (fixtures captured from real payloads, scrubbed of personal paths), permission registry (answer, timeout, superseded, session end), settings generation, launch args.
- An e2e (`e2e/hooks.spec.ts`, opt-in via `TR_E2E_AGENTS=claude`, skipped otherwise) that launches Claude in the app, triggers a Bash permission, answers it via `window.tr.agent.respondPermission`, and sees the command run.
- `docs/spikes/hooks.md` covers: settings merge, Orca coexistence, payload samples, TUI/hook interaction, latency per hook.
- `npm run check` and `npm run test:e2e` pass.
