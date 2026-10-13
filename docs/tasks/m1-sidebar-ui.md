# Task: sidebar-ui — status sidebar from Figma

Milestone M1 (UI) → M2 (live data) · PRD §4 F2 · Figma screens 01 (14:2) and 02 (16:178); components `SessionRow` (11:51), `ProjectHeader` (11:52), `NavItem` (11:81), `WindowControls` (11:82), `StatusGlyph` (9:14) · Branch/worktree: `sidebar-ui`

## Goal
The left sidebar, pixel-faithful to Figma in both themes, driven by the workspace store (mock data for now), with keyboard navigation. Live status from hooks arrives in M2; build so that only the store data changes then.

## You own
- `src/renderer/sidebar/` only. Replace the placeholder.

Use, don't edit: `useWorkspace()` / mock data in `src/renderer/state/`, `StatusGlyph` and `IconButton` in `src/renderer/ui/`, helpers in `src/shared/session-status.ts`. If you need a new shared helper (e.g. elapsed-time formatting), put it in `src/renderer/sidebar/` for now.

## Requirements
- Structure: titlebar (44px, drag region, space for traffic lights at x=16, panel-left toggle) → NavItems "新任务 ⌘N", "跳转到… ⌘K" → project groups (ProjectHeader with session count) → SessionRows → footer "设置 ⌘,".
- SessionRow (52px): StatusGlyph, title, current action (secondary line), right column elapsed time (`4m`, `12m`, `1h`) and `+N −M` in mono using `--diff-*-fg`. Variants: selected, attention (needs_you) — check the Figma variants for exact treatment.
- "等你处理" queue: when any session `needsAttention`, show those first in a top group (see screen 02); the same session is not duplicated below.
- Elapsed time ticks without re-rendering the whole tree every second (one shared timer, coarse minute updates).
- Keyboard: ⌘1–⌘9 select the nth visible session; ⌘J jumps to the next session needing attention; ↑/↓ move selection when the sidebar has focus.
- Hover states, focus-visible rings, truncation with ellipsis; long CJK titles must not break layout.
- Pure logic (grouping, ordering, elapsed formatting, shortcut targets) in `*.ts` with Vitest tests.

## Done when
- Side-by-side with `get_screenshot` of 14:2 and 16:178: spacing, type and color match in dark; light mode (screen 08, 24:1790) matches too.
- `npm run check` passes. Screenshots in the final commit description.
