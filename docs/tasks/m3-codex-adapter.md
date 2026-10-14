# Task: codex-adapter — Codex parity for status, prompts and sending

Milestone M3 · PRD §4 F1/F2/F3 (Codex), §6.2, §9 risks · Branch/worktree: `codex-adapter`

## Goal
A Codex session in the app behaves like a Claude session: live status and current action in the sidebar, approval requests answerable from the prompt bar, reliable composer sends — without writing to `~/.codex/*`.

## You own
- `src/main/hooks/` — add Codex normalization and settings/launch plumbing next to the Claude code (keep Claude behavior unchanged; its tests must stay green).
- `src/shared/agent-launch.ts` (+ tests) — Codex launch args (hooks injection, trust flags already there).
- `src/shared/send-protocol.ts` / `send-executor.ts` — only if the Codex findings require it, with tests.
- `docs/spikes/codex.md` (new), `e2e/codex.spec.ts` (new, opt-in via `TR_E2E_AGENTS=codex`).
- Minimal, called-out edits elsewhere (e.g. `src/shared/session-state-machine.ts` title rules for Codex's spinner).

## Research first (write findings to `docs/spikes/codex.md`)
Codex CLI 0.142.5 is installed. Read its docs (https://developers.openai.com/codex/hooks and the config reference) and, where useful, its source (`codex-rs`). Answer:
1. Which hook events exist and their payloads; is there an approval/permission hook that can **return a decision** (like Claude's PermissionRequest), or only observe?
2. How can hooks be supplied **per launch** without touching `~/.codex`? Candidates: `-c hooks…` inline config, a `--config`/profile file, `CODEX_HOME` pointed at a temp dir that links/merges the user's auth + config (check what breaks: auth, history, sessions), or something else.
3. Hook trust: non-managed hooks need a `trusted_hash` in config. Which per-launch options exist (e.g. `--dangerously-bypass-hook-trust`), what exactly they bypass, and the security trade-off. **If the only workable paths require writing `~/.codex` or a broad trust bypass, stop and report the options instead of choosing — the user decides.**
4. How Codex shows approvals and questions in its TUI and the keystrokes that answer them (for a prompt-bar fallback when no hook can decide).
5. Title / OSC signals (braille spinner; OSC 7501 if present in 0.142.5).
6. Ctrl+C on an empty Codex prompt quits Codex (send spike) — should the composer's Ctrl+C passthrough ask/guard for Codex? Recommend.

## Then implement
- Normalizer: Codex payloads → `AgentEvent` / `PendingPrompt` (`HookAgent = 'codex'`), fixtures from real payloads (scrub paths), tests.
- Launch: per-launch hook injection for Codex with the same env (`TR_SESSION_ID`, `TR_HOOK_SOCK`, `TR_HOOK_TOKEN`) and `tr-hook.sh` (pass `codex` as the agent arg).
- Approvals: if Codex can take a decision from a hook, wire it through the existing permission registry; otherwise emit a `PendingPrompt` and answer with keystrokes (document the exact sequence; the prompt bar uses `runSteps`, so expose a planner the integrator can call — e.g. `planCodexApproval(decision)` in `src/shared/`).
- Status: Codex title rules in the state machine (braille spinner = busy).

## Real-CLI rules
The user's Codex model provider returned 503s during M1 — if turns don't complete, record it, verify what you can (hook delivery, approvals appear) and mark the rest unverified. One fixed lab dir (`/tmp/tr-codex-lab`), trust it per launch with `-c` (no `~/.codex` writes), ≤ 25 short Codex turns, strip `CLAUDECODE` / `CLAUDE_CODE_*` from child envs.

## Done when
- `docs/spikes/codex.md` answers 1–6 with evidence.
- Unit tests for normalization and launch args; `e2e/codex.spec.ts` (opt-in) covers status + one approval.
- `npm run check` and `npm run test:e2e` pass.
