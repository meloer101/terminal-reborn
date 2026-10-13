# Task: spike-send — verify and implement the composer send protocol

Milestone M0/M1 · PRD §4 F1 (发送协议) and §9 risks · Branch/worktree: `spike-send`

## Goal
Find out empirically how to deliver composer text into Claude Code and Codex TUIs reliably, write it down, then implement it as pure, tested code.

## You own
- `docs/spikes/` (findings)
- `scripts/spikes/` (throwaway experiment scripts)
- `src/shared/send-protocol.ts` (types already defined — keep them, add the implementation), `src/shared/send-executor.ts`, and their `*.test.ts`

Do not edit renderer, main or preload code.

## Part 1 — Experiments (write `docs/spikes/send-protocol.md`)
Use a Node script with `node-pty` + `@xterm/headless` (both installed) to launch the real CLI in a temp git repo, write bytes, and read the rendered screen. Installed versions: Claude Code 2.1.289, Codex 0.142.5. Keep prompts trivial (e.g. "reply with just OK") to save tokens.

Answer, with evidence:
1. Claude: does `\r` written separately after a bracketed paste submit reliably? When is Ctrl+Enter / `\x1b\r` needed (multi-line)? How long between paste end and `\r`?
2. Claude: which inputs become a `[Pasted text #N …]` placeholder (length / line thresholds)? Does pasting change instruction-following (the `<pasted_content>` wrapping)? Compare typing vs pasting a short single line.
3. Leading `/` and `#`: confirm that writing the first char as a keystroke opens the slash/memory mode; confirm the arg-less slash command + trailing space trick.
4. Codex: paste-burst window behavior; does `-c tui.disable_paste_burst=true` exist in 0.142.5 and what does it break?
5. Large inputs: 20k ASCII chars and 5k CJK chars — any splitting into multiple placeholders? Delay scaling by UTF-8 byte length.
6. Startup: folder-trust dialog in a fresh directory for each CLI — what appears and how to pre-accept without touching global config beyond the per-project trust entry.
7. Sending while the agent is busy (steer): does it queue or interrupt?

End the doc with a decision table: per agent, the exact step sequence.

## Part 2 — Implementation
- `planSend: PlanSend` in `send-protocol.ts` — pure; returns `SendStep[]` per the findings (first-char keystroke for `/`/`#`, bracketed paste, `waitForText` with needles = visible echo or placeholder, byte-length-scaled timeouts, separate `\r`, Codex extra delay).
- `runSendPlan(steps, io: SendIo, clock?)` in `send-executor.ts` — executes steps against `SendIo`, polls `readScreen()` for `waitForText`, throws a typed error on timeout. Include a per-session serial queue helper (`createSendQueue()`), since two sends to the same PTY must never interleave.
- Tests: table-driven `planSend` cases (ASCII, CJK, multi-line, 20k chars, `/cmd`, `/cmd arg`, `#note`, shell agent) and executor tests with a fake `SendIo` + fake clock (success, timeout, queue ordering).

## Done when
- `docs/spikes/send-protocol.md` answers all 7 questions with observed output.
- `npm run check` passes; new code fully covered by unit tests.
- Commit(s) on your branch; summarize findings that should change PRD §4 F1 in the final commit message.
