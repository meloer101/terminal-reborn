# Changelog

All notable changes to Wavi (named Terminal Reborn until v0.1.1). Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-19

Worktrees, review and a view over every agent. There is no separate 0.2.0: its work ships here.
Worktree、审阅和所有 agent 的总览。没有单独的 0.2.0，它的内容都在这一版里。

### Renamed to Wavi / 改名为 Wavi
- The app is now **Wavi** (bundle id `dev.wavi.app`). Your Terminal Reborn workspace and settings move over on the first launch.
  应用改名为 **Wavi**。旧的工作区和设置会在第一次启动时自动迁移。

### The terminal is the whole interface / 终端就是全部界面
- The input bar and the in-app answer bar are gone: you type straight into the agent's own TUI and answer its prompts there; Wavi only marks the session 等你处理.
  去掉输入栏和应用内作答条：直接在 agent 自己的界面里输入、作答，Wavi 只把会话标成“等你处理”。
- Terminal: ⌘F search, ⌘A / ⌘C / ⌘V with Chinese text, ⌥-drag to select while an agent captures the mouse, screen-reader mode, colors that follow the light / dark theme.
  终端：⌘F 搜索、⌘A / ⌘C / ⌘V（含中文）、agent 开启鼠标上报时按住 ⌥ 拖动选中、读屏模式、底色跟随浅色 / 深色。

### Agents keep running / agent 持续运行
- Quitting with ⌘Q leaves agents running; the next launch reattaches to the same processes and catches up on what happened meanwhile. ⌥⌘Q quits and ends them.
  ⌘Q 退出后 agent 继续运行，下次打开接回同一个进程并补上期间发生的事；⌥⌘Q 退出并结束所有会话。

### Sidebar and overview / 侧栏与总览
- The sidebar groups sessions under collapsible projects, shows each session's last reply and a time that fits its state (本轮用时 · 已等 3m · 5m 前), and ⌘1–⌘9.
  侧栏按项目分组、可折叠；每个会话显示最后一句回复和随状态变化的时间；⌘1–⌘9 切换。
- Session titles come from the agent's own name for the conversation; rename by double-clicking the title.
  会话标题用 agent 自己起的名字；双击标题可重命名。
- Overview (⇧⌘A): a list that opens a session's terminal in place, and a board of status cards with a session overlay.
  总览（⇧⌘A）：列表里原地展开终端，看板用状态色块卡片并可打开会话浮层。
- Notifications name the project and session and say what the agent asked or answered; finishes within a second are merged. 等你处理 is now magenta.
  通知写明“项目 · 会话”和问题或最后一句回复，一秒内的多个完成合并成一条；“等你处理”改用品红。
- A new welcome page, and ⌘B / ⇧⌘B for the left / right panels.
  新的欢迎页；⌘B / ⇧⌘B 切换左 / 右侧栏。

### Worktrees / Worktree
- ⌘N opens a new-session sheet: a new worktree or the current folder, the base branch, the agent; the worktree is created in the background and copies ignored files listed in `.worktreeinclude`.
  ⌘N 打开新建会话面板：新 worktree 或当前目录、基于哪个分支、用哪个 agent；worktree 在后台创建，并按 `.worktreeinclude` 复制被忽略的文件。
- `.tr/settings.toml` scripts (setup / run / archive / test) run after you approve them; every worktree gets its own `TR_PORT` block and a Run button.
  `.tr/settings.toml` 的 setup / run / archive / test 脚本经你确认后运行；每个工作目录有自己的 `TR_PORT` 端口段和 Run 按钮。
- Merge sheet (⇧⌘M): checks ahead / behind, conflicts and uncommitted work, then squash, merge or rebase without leaving a half-done state; conflicts can be handed to the agent.
  合并面板（⇧⌘M）：先检查领先 / 落后、冲突和未提交改动，再 squash / merge / rebase，失败不留半截；冲突可以交给 agent 处理。
- Archive a worktree and bring it back later from ⌘K 历史.
  可以归档 worktree，之后在 ⌘K“历史”里恢复。

### Right panel / 右侧栏
- Browser per worktree (terminal links open there, sign-in pop-ups work), Git graph and changes with unified or side-by-side diffs, a Worktree list and a file tree.
  每个 worktree 一个内置浏览器（终端里的链接在这里打开，支持登录弹窗）；Git 图谱与变更（统一或并排 diff）；Worktree 列表；文件树。
- Comment on diff lines and send them to the agent; a background reviewer can turn its findings into such comments (设置 · 自动化, off by default).
  可以在 diff 行上评论并发给 agent；后台审阅能把发现的问题变成评论（设置 · 自动化，默认关）。
- Ports a session listens on show up in the sidebar and the overview.
  会话监听的端口显示在侧栏和总览里。

### Context, todo and plan usage / 上下文、todo 与额度
- Each session header shows the agent's todo progress, how full its context window is and its vendor's plan usage. Click for the details: the context curve over recent turns with compactions, cache and cost figures, each plan window's pace and when it would run out at this rate, and which sessions used it.
  会话头显示 todo 进度、上下文占用和该厂商的额度。点开看详情：最近几轮的 context 曲线和压缩点、缓存与折算成本、每个额度窗口的进度和按当前速度何时用完、各会话用了多少。
- A system notification at 75 %, 90 % and when a plan window is used up (设置 · 自动化 · 额度提醒).
  额度用到 75%、90% 和用完时各提醒一次（设置 · 自动化 · 额度提醒）。
- This also works for a `claude` or `codex` you type yourself in a plain Wavi terminal. Nothing in your global Claude or Codex config is changed.
  在普通终端里自己敲的 `claude` / `codex` 也一样；不会改动你的 Claude / Codex 全局配置。

### Known limitations / 已知限制
- Still unsigned (ad-hoc): after downloading, run `xattr -cr /Applications/Wavi.app` once.
  仍未签名（ad-hoc）：下载后需要运行一次 `xattr -cr /Applications/Wavi.app`。
- Plan usage appears after the agent's first reply; Codex plan figures on a real ChatGPT account have not been verified yet.
  额度要等 agent 第一次回复后才出现；Codex 在真实 ChatGPT 账号下的额度数据还没有验证过。

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

[Unreleased]: https://github.com/meloer101/terminal-reborn/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/meloer101/terminal-reborn/compare/v0.1.1...v0.3.0
[0.1.1]: https://github.com/meloer101/terminal-reborn/releases/tag/v0.1.1
[0.1.0]: https://github.com/meloer101/terminal-reborn/releases/tag/v0.1.0
