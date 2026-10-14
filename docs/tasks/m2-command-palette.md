# Task: command-palette — ⌘K

Milestone M2 · PRD §4 F8 · Branch/worktree: `command-palette`

## Goal
⌘K opens a keyboard-first palette to jump to any session or run common actions, in the product's quiet visual language.

## You own
- `src/renderer/command-palette/` — replace the placeholder (AppShell already mounts `<CommandPalette />`; it renders nothing while closed).

Use, don't edit: `useWorkspace` (sessions, projects, worktrees, `setActiveSession`, `toggleSidebar`, `setRightPanel`), `newSessionMenu` / `addProjectInteractive` / session creation helpers in `src/renderer/state/session-actions.ts`, `StatusGlyph`, `applyTheme` in `src/renderer/theme.ts`, tokens.

## Requirements
- Export `openCommandPalette()` / `closeCommandPalette()` (module-level store) so the sidebar's "跳转到… ⌘K" can open it later (integrator wires that).
- ⌘K toggles from anywhere, including when xterm or the composer has focus (capture-phase listener, like the sidebar's shortcuts). Esc closes and restores the previous focus.
- Sections: 会话 (status glyph, title, project · current action; sorted by `compareByUrgency`), 操作 (新建 Claude / Codex / Shell 会话 in the current project, 添加项目…, 切换侧栏, 打开变更面板, 主题：跟随系统 / 深色 / 浅色).
- Fuzzy matching over title, project, branch, action — CJK-aware (substring on characters; pinyin not required). Pure matcher + ranking in `*.ts` with Vitest tables.
- ↑/↓ move, ↵ runs, mouse hover/click works; list virtualization not needed (< 200 items).
- IME-safe input (don't run on Enter while composing — reuse the composer's rule: `isComposing` / `keyCode 229` / `key === 'Process'`).
- Visual: centered sheet ~560 px wide, `--bg-raised`, hairline border, `--radius-window`, subtle shadow; scrim `rgba` via a token if you need one (add it to `tokens.css` only if unavoidable and say so). No Figma frame exists — follow the established patterns (NavItem / SessionRow density, tokens, 16 px lucide icons).

## Done when
- Matcher/ranking tests; Playwright: ⌘K opens while the terminal has focus, typing filters, ↵ switches the active session, Esc restores focus; screenshots dark + light.
- `npm run check` and `npm run test:e2e` pass.
