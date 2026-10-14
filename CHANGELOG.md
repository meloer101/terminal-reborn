# Changelog

All notable changes to Terminal Reborn. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/meloer101/terminal-reborn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/meloer101/terminal-reborn/releases/tag/v0.1.0
