# Task: prompt-bar — one-click answers for permissions and questions

Milestone M2 · PRD §4 F3 · Figma component `PromptBar` (11:173), in context on screen 02 (16:178); `OptionItem` (9:61) · Branch/worktree: `prompt-bar`

## Goal
When the active session's agent asks for permission or asks a question, a bar above the composer shows it; the user answers with a click or a digit key and the agent continues.

## You own
- `src/renderer/prompt-bar/` — replace the placeholder (AppShell already mounts `<PromptBar />` between terminal and composer).
- `src/shared/question-keys.ts` (+ test): pure planner for answering an AskUserQuestion menu with keystrokes.

Use, don't edit: `window.tr.agent.onPrompt` / `onPromptResolved` / `respondPermission`, `PendingPrompt` / `AgentQuestion` types (`src/shared/agent-events.ts`), `runSteps(sessionId, steps)` from `src/renderer/session-io.ts` (keystrokes on the session's serial queue), `SendStep` from `src/shared/send-protocol.ts`, `useActiveSession()`.

Hooks that produce prompts are built in parallel (`hooks-bridge`), so develop against a fake source: a test hook (only when `globalThis.__TR_E2E__`) that injects `PendingPrompt`s into your store.

## Requirements
- **Store** (`prompt-bar/store.ts`): pending prompts keyed by session, FIFO; removed on `onPromptResolved`, on our own answer, or when the session closes. Export a selector other features can use later (sidebar inline reply, "1 of N").
- **Permission UI:** tool + summary (mono for commands/paths), buttons 允许一次 · 总是允许 (only if `canAllowAlways`) · 拒绝; shows "1 / N" when several are queued.
- **Question UI:** header + question, options as `OptionItem`s numbered 1…N plus "其他…" (free text) — single select submits on choose; multi-select toggles then 提交. Multiple questions are answered in sequence.
- **Keyboard:** when the bar is visible and the composer is empty (or focus is outside the composer), keys 1–9 choose; with text in the composer use ⌥1–9. Esc does not dismiss (the agent is still waiting) — it just returns focus.
- **Answering a question by keystrokes** (`planQuestionAnswer(question, selection) → SendStep[]`): Claude 2.1.x AskUserQuestion menu semantics — single: press the option's digit; multi: digits toggle, then → / Enter per Claude's current UI; other: N+1 then type text then Enter; leave ~500 ms between groups. Verify against the real CLI (below) and encode the exact sequence; reference Orca's `native-chat-ask.ts` (MIT) for prior art, attribute if you adapt code.
- After answering, remove the prompt optimistically; if the agent re-asks, the new prompt replaces it.
- Matches Figma 11:173 in dark + light; status color only for the attention accent.

## Verification with the real CLI
Fixed lab dir `/tmp/tr-prompt-lab` (one trust entry max, report it), strip `CLAUDECODE` / `CLAUDE_CODE_*`. Drive `claude` via node-pty + `@xterm/headless` (see `scripts/spikes/` for a harness) to confirm the AskUserQuestion key sequences for single, multi and other. Budget **≤ 15 short turns**. Never touch global configs.

## Done when
- `question-keys` table tests for single / multi / other / multiple questions; store tests.
- Playwright with injected prompts: permission click calls `respondPermission` with the right decision; digit keys select; ⌥digits when composer has text; screenshots dark + light.
- `npm run check` and `npm run test:e2e` pass.
