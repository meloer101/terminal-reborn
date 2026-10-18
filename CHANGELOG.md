# Changelog

All notable changes to Wavi (named Terminal Reborn until v0.1.1). Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Renamed to Wavi / 改名为 Wavi
- The app is now **Wavi** (bundle id `dev.wavi.app`). Your Terminal Reborn workspace and settings move over on the first launch with nothing running from the old profile.
  应用改名为 **Wavi**。旧的工作区和设置会在第一次启动、且旧配置下没有仍在运行的会话时自动迁移过来。
- Developers: `npm run app:install` puts a Wavi.app in Applications that runs the checkout's build; `npm run build` (or `build:watch`) reloads it or offers a restart. `npm run dev` now uses its own “Wavi Dev” profile.
  开发者：`npm run app:install` 安装一个运行本仓库构建的 Wavi.app，`npm run build` 后自动刷新界面或提示重启；`npm run dev` 改用独立的 “Wavi Dev” 配置。

### No dead ends (phase 2b · P0) / 没有死角
- With no session open, the main area shows how to start: 打开项目 ⌘O, recent folders, whether Claude Code / Codex are installed (with the install command), and folder drop. The composer is hidden until there is a session.
  没有会话时，主区给出下一步：打开项目 ⌘O、最近项目、Claude Code / Codex 是否已安装（附安装命令）、拖入文件夹；没有会话时不再显示输入栏。
- Permission options say what they allow: 允许 · 允许，本会话不再询问 pnpm prisma · 拒绝并说明…; denying puts the caret in the composer, whose hint becomes “回复 Claude，或按 1–3 直接选择”.
  权限选项写明范围；拒绝后焦点回到输入栏，输入栏提示改为“回复 Claude，或按 1–3 直接选择”。
- The session header’s … opens a real menu: 重命名… (or double-click the title), 在 Finder 中显示, 复制路径, 关闭会话.
  标题栏“…”现在有菜单：重命名（也可双击标题）、在 Finder 中显示、复制路径、关闭会话。
- Hidden until they have content: the right-panel toggle and its ⌘K action, and the 通用 / 终端 / Agent / 快捷键 settings panes.
  尚未完成的入口先隐藏：右侧面板开关及其 ⌘K 操作、设置里的通用 / 终端 / Agent / 快捷键。
- The main column never gets narrower than 560 px: when the right panel does not fit it floats over main, and it has a close button.
  主区最小宽度 560 px；放不下时右侧面板浮在主区上方，面板也有关闭按钮。

## [0.1.1] - 2026-10-15

Reliability release: agents no longer get lost to a click, a restart or a crash.
可靠性版本：agent 不会再因为误点、重启或崩溃而丢失。

### Sessions survive / 会话不再轻易丢失
- Closing the window only hides it; agents keep running. ⌘Q asks first when sessions are running or waiting for you.
  关闭窗口只是隐藏，agent 继续运行；有运行中或等你处理的会话时，⌘Q 会先确认。
- After a restart, a Claude Code / Codex session resumes its previous conversation (`--resume`) the first time you open it.
  重启后第一次打开会话时，用 `--resume` 接上原来的对话。
- Closing a running session (now also ⌘W) or removing a project with running sessions asks first.
  关闭运行中的会话（新增 ⌘W）或移除有运行中会话的项目前会确认。
- If the terminal engine crashes it restarts automatically, and affected sessions offer 全部恢复.
  终端进程崩溃后自动重启，受影响的会话可一键全部恢复。
- Workspace, drafts and window position are saved by the app itself (migrated automatically).
  工作区、草稿和窗口位置改由应用自己保存（自动迁移）。

### Honest status / 状态更准确
- New session states: 正在启动 / 未启动 · 点击恢复 / 等你确认：信任此文件夹 / 已退出, with cards that say what to do.
  新增启动中、未启动、被首次弹窗挡住、已退出等状态，并给出下一步操作。
- The composer is disabled when no agent is running, so text is never run as a shell command.
  没有 agent 运行时输入栏停用，文字不会被当作 shell 命令执行。
- `/clear` no longer freezes a session as 已退出; interrupted turns return to 空闲 within seconds.
  `/clear` 后状态不再卡死；被中断的回合几秒内回到空闲。
- Missing `claude` / `codex` command or a deleted project folder is reported with a hint instead of failing silently.
  找不到 `claude` / `codex` 命令或项目目录被删除时会明确提示。
- Hooks self-heal; when they are unavailable the header says status follows the terminal title.
  hooks 会自愈；不可用时标题栏会提示状态仅按终端标题判断。

### Also / 其他
- Settings is a dialog in the main window; the sidebar opens projects (⌘O) and starts sessions from each project; the composer and prompt bar are floating cards.
  设置改为主窗口内弹窗；侧栏可直接打开项目（⌘O）并在项目里新建会话；输入栏和选项条改为悬浮卡片。
- Packaged builds no longer include Reload / Developer Tools.
  正式版去掉了“重新加载 / 开发者工具”。

## [0.1.0] - 2026-10-14

First public release. Unsigned (ad-hoc signature): see the README for the one-time `xattr -cr`.
首个公开版本。仅 ad-hoc 签名，首次打开前请按 README 运行一次 `xattr -cr`。

### Terminal / 终端
- Real PTY terminals (xterm.js + node-pty in a utility process), many sessions in parallel, each agent keeps its native TUI.
  真实 PTY 终端，多会话并行，agent 保留原生 TUI。
- Projects and sessions with a status sidebar; Claude Code and Codex launch per session.
  项目与会话侧栏；每个会话可启动 Claude Code 或 Codex。

### Composer / 输入栏
- A real text editor for prompts: select and delete, IME-safe for Chinese input, drafts saved per session, image attachments.
  真正的输入栏：可选中删除、中文输入法安全、按会话保存草稿、支持图片附件。
- Measured send protocol (queue while the agent is busy, multi-line paste, first-run dialog guard).
  按实测制定的发送协议（agent 忙时排队、多行粘贴、首次对话框保护）。

### Status and instant replies / 状态与即时回复
- Live per-session status (working, waiting for you, done) from per-launch Claude hooks; system notifications and Dock badge.
  基于每次启动注入的 Claude hooks 显示实时状态；系统通知和 Dock 角标。
- Permission requests and AskUserQuestion answered with one click or the number keys, right above the composer.
  权限确认和选项问题在输入栏上方一键或数字键作答。
- Command palette on ⌘K with CJK-aware search.
  ⌘K 命令面板，支持中日韩文字模糊搜索。
- Hooks never touch `~/.claude/settings.json` or `~/.codex`.
  不会修改全局 agent 配置。

### Appearance and Codex / 外观与 Codex
- Settings window (⌘,): separate Latin and CJK fonts, size, line height, ligatures, solid / gradient / image background, sidebar vibrancy, light and dark themes, live preview. Changes apply to running terminals immediately.
  设置窗口（⌘,）：中英文字体分别设置、字号、行高、连字、纯色 / 渐变 / 图片背景、侧栏毛玻璃、浅色/深色主题、实时预览；修改立即应用到正在运行的终端。
- Codex sessions get live status and app-side approvals through per-launch hooks (trust pinned per launch, nothing written to `~/.codex`). Ctrl+C from an empty composer no longer quits an idle Codex. Verified with Codex 0.142.5 against a local mock model; real-model behaviour is still being validated.
  Codex 会话同样有实时状态和应用内的权限确认（每次启动注入 hooks，按次固定信任，不写 `~/.codex`）；输入栏为空时按 Ctrl+C 不会再让空闲的 Codex 退出。已在 Codex 0.142.5 + 本地模拟模型上验证，真实模型下的表现仍在验证中。

### Known limitations / 已知限制
- Not notarized: run `xattr -cr` once after download (see README). Worktree management and the git graph are planned for later releases.
  未经 Apple 公证，下载后需运行一次 `xattr -cr`。Worktree 管理与 Git 图谱在后续版本。
- Image backgrounds work in the packaged app but not under `npm run dev`. Terminals with a gradient or image background use the slower DOM renderer.
  图片背景仅在打包版生效（开发模式不显示）；使用渐变或图片背景时终端改用较慢的 DOM 渲染。

### Distribution / 发布
- Signed ad-hoc `.dmg` and `.zip` for Apple Silicon (arm64) and Intel (x64); macOS 13 or later.
  提供 Apple 芯片（arm64）和 Intel（x64）的 `.dmg` 与 `.zip`，需要 macOS 13+。
- The app tells you when a newer GitHub release exists (one notification per version; nothing is downloaded or installed automatically). No telemetry.
  有新版本时提示一次（不会自动下载或安装）；无任何遥测。

[Unreleased]: https://github.com/meloer101/terminal-reborn/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/meloer101/terminal-reborn/releases/tag/v0.1.1
[0.1.0]: https://github.com/meloer101/terminal-reborn/releases/tag/v0.1.0
