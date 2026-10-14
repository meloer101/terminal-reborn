# Spike: answering Claude Code's AskUserQuestion menu with keystrokes

Claude Code 2.1.299, driven through node-pty + `@xterm/headless` (`scripts/spikes/22-ask-user-question.mjs`),
lab dir `/tmp/tr-prompt-lab`. 10 short Claude turns in total. Encoded in `src/shared/question-keys.ts`.

Menu shapes (rows are numbered; the last two rows are always `Type something` = N+1 and `Chat about this` = N+2):

| Case | Keys that worked | Observed |
|---|---|---|
| single question, single select | `N` | selects and submits at once; no review screen |
| single select, free text | `N+1`, text, `Enter` | `N+1` opens a text field (row shows the typed text), Enter submits |
| 2+ questions | per question as above | after each answer the TUI moves to the next tab; after the last it shows "Review your answers" with `1. Submit answers` preselected -> one more `Enter` |
| multi select | `N` per option | toggles `[✔]`; cursor stays on row 1 |
| multi select, leave | `→` (`ESC [ C`) | goes to the next question tab, or to the review screen after the last; then `Enter` on `1. Submit answers` |
| multi select, free text | `↓` x N (cursor to the `Type something` row), text, `↓` (to the `Submit` row), `Enter` | the digit `N+1` only ticks the row and does **not** open the field; typing ticks it; `Enter` / `→` inside the field do not leave it (Enter unticks the row) |

Not verified: more than 9 options (digit shortcuts end at 9; the planner uses arrows + Enter beyond that),
free text for a single-select question that is not the last of several (same keys as the verified single case).

Planner check against the real CLI (`planQuestionAnswer` + `runSendPlan`): Q1 single `Blue`, Q2 multi `Apple, Cherry` +
free text `kiwi` -> the TUI reported `Pick a colour -> Blue`, `Pick fruits -> Apple, Cherry, kiwi`.

Side effect: accepting the trust dialog added `projects["/private/tmp/tr-prompt-lab"].hasTrustDialogAccepted = true`
to `~/.claude.json` (one entry).
