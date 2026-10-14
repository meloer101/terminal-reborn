# Task: hooks-reliability — status that doesn't silently die (phase 2a · A9, A10, Codex probe)

Read `docs/phase2/plan.md` (A9, A10) and `docs/spikes/hooks.md`, `docs/spikes/codex.md` first.

## You own
- `src/main/hooks/` (server, index, codex-probe, settings) and `resources/hooks/tr-hook.sh`
- `src/main/settings.ts`

## Requirements
1. **Socket location:** move the hook socket + generated settings file out of `$TMPDIR` into `<userData>/hooks/` (keep the socket path < 104 bytes; fall back to a short `/tmp/tr-<uid>-<rand>` dir only if needed). Sweep stale `tr-hooks-*` dirs from older runs at startup.
2. **Self-healing server:** keep an `error` listener for the server's lifetime; a periodic self-check (e.g. every 30 s: socket file exists and accepts a connection) restarts the server and rewrites the settings file if needed. Log, don't crash.
3. **Health signal:** expose to the renderer whether hooks are available (additive IPC, e.g. `agent.onHooksHealth({ ok, reason })` or include it in an existing channel) so the UI track can show "状态仅按标题判断". Also emit per-session "no SessionStart within N s of launch" as a signal the UI can use.
4. **Codex probe:** reject on child `exit`/`close`; cache a negative result for a few minutes; if `codex` is missing, fail fast with a clear reason. No 10 s hangs per launch.
5. **Settings writes:** fix the write chain so one failure doesn't stop later writes; report failures (log + a renderer-visible error event, additive); a corrupt `settings.json` is backed up (`settings.json.bad-<ts>`) before falling back to defaults.
6. Orphan guard: a spawn that times out in main must not leave a live process in the host (kill it when the late spawn arrives).

## Done when
- Unit tests for the self-check, sweep, probe failure paths, settings write-chain recovery (inject failing fs).
- Existing hooks e2e still pass (`TR_E2E_AGENTS=claude npx playwright test hooks` — at most 3 short Claude turns, trusted lab dir).
- `npm run check` and `npm run test:e2e` pass.
