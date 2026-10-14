# Spike: composer send protocol

Date: 2026-10-13 · Platform: macOS (Darwin 25.3, Apple Silicon) · Harness: `node-pty` + `@xterm/headless` (120x40)

Versions actually measured:

| CLI | Version | Note |
|---|---|---|
| Claude Code | **2.1.296** (the brief said 2.1.289; the installed binary had been updated) | logged in via claude.ai, default permission mode "auto" |
| Codex | **0.142.5** | custom provider via API key; the backend returned a few `503` errors, so Codex turn completion was not always observable |

Scripts: `scripts/spikes/` (`harness.mjs` is the shared PTY/xterm harness, numbered files are the experiments).
Ground truth for "what the model received" is the CLI's own transcript (Claude: `~/.claude/projects/<cwd>/*.jsonl`,
Codex: `~/.codex/sessions/**/rollout-*.jsonl`), not the screen. All prompts were trivial ("Reply with just OK").
Roughly 60 short Claude turns and 25 Codex turns were made in total (many were interrupted or answered in a few tokens).

Side effects on the user's machine (everything else ran in throw-away temp repos under `$TMPDIR/trspike-*`):

- `~/.claude.json`: one per-project entry, `projects["/private/var/folders/8g/bmnzm0gn4kl9wjyzfry2r_780000gn/T/trspike-claude-trust-pQxGE0"].hasTrustDialogAccepted = true` (plus Claude's usual bookkeeping fields). Created by accepting the trust dialog once. Nothing else was written.
- `~/.codex/config.toml`: **nothing** (trust was supplied per launch with `-c`).
- Both CLIs wrote their normal session logs for the temp repos.
- Env of the child processes had `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_*`, `ORCA_*` removed.

---

## 1. Claude: `\r` after a bracketed paste, and multi-line

**Does a separately written `\r` submit?** Yes, at every delay tried.

| Input (Claude 2.1.296) | `\r` written after | Result |
|---|---|---|
| 19-char single line | 0, 10, 30, 60, 120, 250 ms | submitted 6/6 (turn started and `⏺ OK` returned) |
| 4-line text (becomes `[Pasted text #N +3 lines]`) | 0, 30, 50, 120 ms | submitted every time |
| 20 000 ASCII chars | 0 ms and 250 ms | submitted; model received all 20 110 chars |
| 5 000 CJK chars (15 000 bytes) | 0 ms | submitted; model received all 5 110 chars |

**Surprise: the "any byte after `ESC[201~` in the same write discards the paste" failure from the research report did
not reproduce.** Paste and `\r` in a *single* `write()` also submitted (single line, 4-line placeholder, 20k ASCII,
5k CJK; verified in the JSONL). The research claim may be true for older versions or other timings. The protocol keeps
the separate `\r` after a closed-loop check because it is free insurance, but 2.1.296 does not need it.

**Newline keys (typed input, nothing submitted):** after `first` + key + `second`:

| Key | Result |
|---|---|
| `ESC CR` (Alt+Enter) | newline |
| `LF` (Ctrl+J) | newline |
| `CSI 13;2u` (Shift+Enter, kitty) | newline |
| `CSI 13;5u` (**Ctrl+Enter**, kitty) | **submits** (`first` reached the model) |
| `\` + `CR` | inconclusive in this run (a turn was already running) |

So Ctrl+Enter is a *submit* key in 2.1.296, not a newline key; cmux's use of it for multi-line is just another submit.
It is **never needed**: newlines inside a bracketed paste are literal, so a multi-line message is one paste + `\r`.
`ESC CR` is only needed when *typing* multi-line text (see Q3, slash commands).

**How long between paste end and `\r`?** 0 ms already works. The planner uses a closed loop (wait until the text
or placeholder is on screen) and then 60 ms for Claude. Paste echo latency was below one 50 ms poll for every size up
to 200 000 chars in the headless harness (Q5).

## 2. Claude: placeholders and `<pasted_content>`

Thresholds (paste of a single bracketed block; measured on the rendered input box and confirmed in the JSONL):

| Paste | Rendered as |
|---|---|
| 800 chars (ASCII or CJK) | inline text |
| **801+ chars** (UTF-16 length; CJK 801 chars = 2 403 bytes, 340 CJK chars = 1 020 bytes stayed inline) | `[Pasted text #N]` |
| 2 newlines (3 lines) | inline |
| **3+ newlines** (4 lines), even if short | `[Pasted text #N +3 lines]` |
| 5 lines with CRLF | `[Pasted text #N +4 lines]` (CRLF is accepted) |
| single line + trailing `\n` | inline |
| 2 pastes of 600 chars | inline (the limit is per paste) |

The counter `#N` keeps increasing across clears (`#1`…`#9`), so the needle must be the prefix `[Pasted text`. Claude shows
a "paste again to expand" hint under the box. On submit the placeholder is expanded in the transcript echo (a 20k paste
floods the screen with 20k characters, and Claude sometimes clears scrollback), so never use old scrollback as evidence.

**What the model receives (session JSONL):**

| Delivery | User message as stored |
|---|---|
| typed `Reply with just the word ALPHA.` | `Reply with just the word ALPHA.` |
| pasted short single line | identical to typed (no wrapper) |
| pasted 3 lines (inline) | plain text, no wrapper |
| pasted 4 lines / 850 chars (placeholder) | `"\n\n<pasted_content id=\"1578\">\nReply with…\n</pasted_content id=\"1578\">\n"` |
| typed `R` then pasted rest (placeholder) | `R\n\n<pasted_content …>eply with…` (the word is split!) |
| typed + Alt+Enter + typed | `line1\nline2`, plain |

**Does the wrapper change instruction-following?** In every placeholder case the model still obeyed the instruction
inside (it answered `DELTA`, `ECHO`, `FOXTROT`, `OK` as asked, also for the 20k and CJK pastes). Not tested: long,
complex instructions. So the research report's suggested "type the first line, paste the rest" hack is **not needed and
harmful** (it splits the first word). Pasting a short single line is identical to typing it.

## 3. Leading `/` and `#`

**Claude 2.1.296**

- Keystroke `/` opens the slash menu. *Pasting* `/help` also opens it, and Enter then runs the command: pasted
  `/model`, `/mod`, `/mod ` and keystroke `/` + paste `model` all opened the model picker (nothing reached the model).
  Unknown `/zzznotacmd` pasted: `Unknown command: /zzznotacmd`, handled locally.
- **Fuzzy execution is real:** pasted partial `/mod` + Enter runs the highlighted `/model`. The trailing space does
  **not** protect against it in Claude (`/mod ` also ran `/model`).
- **A `/…` paste that becomes a placeholder is no longer a command.** Pasting `/zzznotacmd line1\nline2\nline3\nline4`
  was sent to the model as `<pasted_content>/zzznotacmd …`. Keystroke `/` + placeholder paste gives
  `/\n\n<pasted_content …>`. Typing the same text with `ESC CR` for newlines gave `Unknown command` locally and
  nothing reached the model. Therefore long/multi-line slash text must be **typed**.
- Typed delivery details: one raw 1 200-char write is treated as a paste by Claude and garbled
  (`[Pasted text #1]cdefghij…` — the first characters are eaten into the placeholder); 12 chunks of 100 chars with 15 ms
  gaps stayed inline and unwrapped; raw `\n` inside one small write also became newlines.
- **`#` has no special mode in 2.1.296**: typing `#` or pasting `# note` just shows the text in the box (no memory-mode
  indicator). So no first-char keystroke is needed for `#`.

**Codex 0.142.5**

- Pasted `/status` and keystroke `/` + paste `status` both ran `/status`. Partial pasted `/stat` + Enter ran the
  highlighted `/status` (same fuzzy risk). `/status ` (exact + space) ran. **`/stat ` (partial + space) →
  `Unrecognized command '/stat'`: the trailing space makes Codex require an exact name**, so for Codex the
  "argument-less command gets a trailing space" trick is a real safety net.
- A slash command whose arguments exceed 1 000 chars becomes `[Pasted Content N chars]`, but Codex still parses the
  expanded text: `/zzznotacmd <1100 chars>` → `Unrecognized command`; `/status <1100 chars>` was sent to the model
  as plain text (status takes no args). Typed delivery for Codex was not tested (see unverified).
- No `#` mode.

**Decision:** keep the `/` keystroke + paste-the-rest for short slash text (verified working on both, and it is the
defensive choice for older versions), append a space to argument-less commands, and type (chunked) Claude slash text
that would otherwise become a placeholder. `#` is plain text.

## 4. Codex: paste-burst

- Bracketed paste + `\r`: **submits at 0, 50 and 150 ms** (also for the 4-line text, 20k ASCII, 5k CJK).
  The 120 ms burst window only affects *unbracketed* input.
- Unbracketed (raw) text + `\r` in the default configuration: not submitted at 0 ms (0/4), the `\r` became a newline;
  submitted at 60 ms and 150 ms. So the paste-burst heuristic is real for raw input.
- `-c tui.disable_paste_burst=true`: **ignored** (0 ms raw Enter submitted 1/4). The key is **top-level**:
  `-c disable_paste_burst=true` (the binary's `ConfigToml` field list contains `disable_paste_burst` next to
  `check_for_update_on_startup`); with it 0 ms raw Enter submitted 3/4 times (still timing-sensitive).
  `--strict-config` could not be used to check key validity because the user's `~/.codex/config.toml` has an unknown
  field (`disable_response_storage`) that aborts startup under it.
- What disabling breaks: with the heuristic off, raw multi-line typing would submit on the first newline. Because the
  protocol only ever sends a *bracketed* paste, the switch is unnecessary. Recommendation: do not set it; keep the
  150 ms pre-Enter delay as insurance only.
- Codex placeholder: `[Pasted Content N chars]` for **> 1 000 chars** (1000 inline, 1001 placeholder; CJK counted in
  chars too); line count is irrelevant (10 lines stay inline). The model gets the text verbatim (20 052 chars
  received for a 20 000-char filler), no wrapper.
- Ctrl+C on an **empty** Codex prompt quits Codex (it cleared text only when non-empty).

## 5. Large inputs

| Paste | Claude 2.1.296 | Codex 0.142.5 |
|---|---|---|
| 20 000 ASCII | one `[Pasted text #5]` | one `[Pasted Content 20000 chars]` |
| 5 000 CJK (15 000 B) | one `[Pasted text #6]` | one `[Pasted Content 5000 chars]` |
| delivered to the model | full text (+ wrapper) | full text |
| paste → visible | < 100 ms (first poll) up to 200 000 chars / 180 KB CJK | same |

No splitting into multiple placeholders happened with bracketed paste. (The research report's "20k chars → 8
placeholders" is the *unbracketed* case: a raw multi-KB write is chopped by the kernel; we never do that.)
In this headless harness latency did not scale measurably with size, so the byte-scaled timeout
(`2 s + 25 ms/KB of UTF-8, max 20 s`) is a budget for a loaded Electron app (10 sessions, IPC hops), not a measured need.
CJK is 3 bytes/char, so a char-based budget would be 3x too small.

## 6. Startup: trust dialogs

**Claude** — fresh git dir, `claude` shows a full-screen "Accessing workspace / Quick safety check" dialog with
**`❯ No, exit` pre-selected** and `Yes, I trust this folder` second. Keys sent within ~1 s of the first paint are
ignored; after 1.5 s `ESC [ B` (Down) moved the selection and `\r` accepted. Digit keys did nothing. `--bare` and
`--permission-mode acceptEdits` do **not** skip the dialog. Accepting wrote exactly one global entry:
`~/.claude.json` → `projects[<realpath>].hasTrustDialogAccepted = true`; the next launch had no dialog.
There is no CLI flag/env to pre-accept without touching `~/.claude.json`.

**Codex** — a pending update shows a modal first (`1. Update now / 2. Skip / 3. Skip until next version`), suppress it
with `-c check_for_update_on_startup=false`. Then `Do you trust the contents of this directory?` with `1. Yes, continue`
pre-selected. Pre-accept **per launch, with no global write**:

```
codex -c check_for_update_on_startup=false -c 'projects={"/abs/realpath"={trust_level="trusted"}}'
```

The dotted spelling `-c 'projects."/abs/path".trust_level="trusted"'` did **not** work (dialog still appeared); the
inline-table form did. (The user's global config trusts the home directory but that does not cascade to temp dirs.)

**Decision:** `detectBlockingDialog(screen)` recognises `claude-trust`, `codex-trust`, `codex-update`; the composer
must stay disabled while one is on screen. For Claude, either let the user answer in the terminal (preferred: it is a
security decision) or, on explicit user consent, send Down + Enter after ≥1.5 s. Do not auto-write `~/.claude.json`
without an explicit setting.

## 7. Sending while the agent is busy

- **Claude:** the message is **queued**, the running turn is not interrupted. The TUI shows the message with
  `ctrl+x ctrl+s to send now` and the prompt reads `Press up to edit queued messages`. In the end-to-end run the
  story finished first and `ECHO` was delivered afterwards, in order.
- **Codex:** the message is shown as `Messages to be submitted after next tool call (press esc to interrupt and send
  immediately)` — i.e. queued/steered at the next tool-call boundary, no interrupt. Several queued messages were
  merged into **one** user message (`BRAVO…` + `CHARLIE…` arrived concatenated).
- Gotcha: Esc-interrupting Claude before it answered **puts the interrupted message back into the input box**, so
  the next paste is appended to it.

PRD wording "busy ⇒ steer" should read "busy ⇒ queued"; the composer should say 排队中 and may offer Esc to interrupt.

## End-to-end check of the shipped code

`scripts/spikes/21-e2e-plan.mjs` bundles `src/shared/send-protocol.ts` + `send-executor.ts` and drives the real CLIs
through `createSendQueue`:

- Claude: ASCII, 4-line (placeholder), 1 553-char CJK+ASCII, 1 251-char ASCII, send-while-busy, and `/model` all
  worked; the model received each message (placeholders wrapped as described); each send took ~90 ms.
- Codex: all plans executed (~180 ms each, `/status` ran). Because the provider returned `503`s the turns did not
  finish, so later messages were queued and merged by Codex; every message's text still arrived intact.

## Decision table (what `planSend` does)

| Case | Claude Code | Codex |
|---|---|---|
| empty / whitespace | no steps | no steps |
| plain text | normalize (LF, strip ESC/ctrl chars) → `ESC[200~ text ESC[201~` → wait for echo prefix (≤20 chars) **or** `[Pasted text` → 60 ms → `\r` | same, needle `[Pasted Content`, 150 ms |
| wait timeout | `2 s + 25 ms/KB UTF-8`, max 20 s; counts only *new* occurrences vs. plan start | same |
| over placeholder limit | >800 chars or ≥3 newlines → wait only for `[Pasted text` | >1000 chars → wait only for `[Pasted Content` |
| `/cmd` (no args) | `/` keystroke, 150 ms, paste `cmd␠`, wait, 60 ms, `\r` | same, 150 ms before `\r` |
| `/cmd args` (fits inline) | `/` keystroke, 150 ms, paste `cmd args`, wait, `\r` | same |
| `/cmd …` over the limit | **typed**: 100-char chunks, 15 ms gaps, newline = `ESC CR`, wait for last line start, `\r` | paste (typed mode unverified) |
| `#note` | plain text (no mode) | plain text |
| multi-line | one paste, `\r` separate (never Ctrl+Enter: it submits) | one paste |
| busy agent | same plan; message is queued | same plan; queued, merged |
| shell | single line: raw text, 20 ms, `\r`; multi-line: bracketed paste, 20 ms, `\r`; no waits | same |
| first run | `detectBlockingDialog` = `claude-trust` → block composer | `codex-trust` / `codex-update` → pre-accept with `-c` flags above |

## Changes this implies for PRD §4 F1

1. Step 2: drop `#` (no memory mode in 2.1.296). Keep `/` as a keystroke only for inline-size text; Claude `/cmd` text
   over 800 chars or ≥3 newlines must be typed (a pasted placeholder stops being a command). Trailing space is protective
   in Codex only; fuzzy partial names (`/mod`) run the highlighted command in both CLIs.
2. Step 4: placeholder triggers are agent specific: Claude >800 chars or ≥3 newlines; Codex >1000 chars.
   Claude additionally wraps placeholder pastes in `<pasted_content>` (model still obeys the text). No first-line typing hack.
3. Step 5: a separate `\r` is not required in 2.1.296 (single-write also submitted) and Codex needs no 120 ms wait after
   a *bracketed* paste; keep both as cheap insurance, flagged as version-dependent. Ctrl+Enter submits in Claude.
4. Step 6: busy ⇒ queued (Claude) / delivered at next tool call and merged (Codex), not steer.
5. Add a startup step: detect the Claude trust and Codex trust/update dialogs; pre-accept Codex with
   `-c 'projects={"<path>"={trust_level="trusted"}}'` (no global write); Claude has no such option.
6. §9: send-protocol risk is mostly retired for the two measured versions; keep the per-version regression script
   (`scripts/spikes/21-e2e-plan.mjs`) as the matrix.

## Not verified

- Claude versions other than 2.1.296 and Codex other than 0.142.5 (the separate-`\r` hazard may exist elsewhere).
- Instruction-following with long or complex pasted instructions inside `<pasted_content>`.
- Typed (non-paste) delivery in Codex for long slash arguments; chunk size/gap under heavy load.
- Whether `\` + Enter works as a newline in Claude (inconclusive run).
- Delivery-order guarantees for Codex queued messages beyond the merge behaviour seen.
- Real xterm.js (WebGL) timing inside Electron; headless latency is a lower bound.
- IME paths (the composer bypasses them by design).
