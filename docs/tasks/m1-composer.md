# Task: composer — the desktop-grade input box

Milestone M1 · PRD §4 F1 · Figma component `Composer` (11:172, variants AgentRunning=true/false), in context on screen 01 (14:2) · Branch/worktree: `composer`

## Goal
A real text editor under the terminal: select-and-delete, IME-safe, per-session drafts, file/image attachments, and pass-through keys — so nobody has to fight the agent TUI's input line again.

## You own
- `src/renderer/composer/` only. Replace the placeholder.

Integration points you **call** but don't edit:
- `submitPrompt(sessionId, text)` and `sendPassthrough(sessionId, key)` from `src/renderer/session-io.ts`
- `useActiveSession()` from `src/renderer/state/workspace.ts`
- `window.tr.files.pathForFile(file)` / `window.tr.files.saveTempImage(bytes, ext)`
- `PassthroughKey` from `src/shared/keys.ts`

## Requirements
- Native multi-line editing (textarea or contenteditable — pick and justify in the commit); autogrow from 1 line up to ~10 lines, then scroll. Font: `--text-composer`.
- ↵ sends, ⇧↵ newline. **IME safety**: never send while `event.isComposing`, `keyCode === 229`, or `key === 'Process'`.
- After send: clear input, keep focus. If `submitPrompt` rejects, restore the text and show an inline error.
- Drafts per session id, persisted across restarts (localStorage is fine for M1), restored on session switch. Esc never clears a draft.
- Pass-through when the input is **empty**: Esc, ↑, ↓, ⇧Tab, Ctrl+C → `sendPassthrough`. When non-empty these keys behave normally in the editor.
- Attachments: drag & drop files → insert their absolute paths; paste an image → `saveTempImage` → insert the path. Show attachments as compact chips above the input if that matches Figma; otherwise inline paths.
- Toolbar per Figma (attach, @ mention placeholder, image; stop button when the agent is running → `sendPassthrough('escape')`; send button).
- Focus: ⌘L focuses the composer from anywhere.
- Put decision logic in pure functions (`composer-keys.ts`: given keydown facts + input state → action) with Vitest tables covering every rule above, including IME cases.

## Done when
- Matches Figma 11:172 in dark + light (check with `get_screenshot`).
- Manual check with system Pinyin: selecting a candidate with ↵ never sends.
- `npm run check` passes. Screenshots in the final commit description.
