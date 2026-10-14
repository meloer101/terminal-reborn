# Terminal Reborn

一个为并行运行多个 CLI coding agent（Claude Code、Codex）而做的 macOS 终端。
A macOS terminal for running many CLI coding agents in parallel.

> 状态：v0.1.0 首个公开版本，仅 macOS，尚未做 Apple 公证。
> Status: v0.1.0, first public release. macOS only, not yet notarized.

它保留 agent 原生的终端界面，并在其上补齐：

- **真正的输入栏**：可以选中删除、中文输入法安全、按会话保存草稿
- **状态侧栏**：每个 agent 在做什么、哪个在等你，一眼可见；权限确认和选项一键作答
- **外观**：英文和中文字体分别设置，背景、主题、浅色模式
- 规划中 / Planned：Worktree 全链路（一步开新任务、本地合并前预检冲突、冲突交给 agent 解决）、带 agent 状态的 Git 图谱。见 [路线图](docs/PRD.md#8-开发路线图)

It keeps each agent's native TUI and adds a real text editor for prompts, an at-a-glance status sidebar with one-click answers, the full worktree lifecycle with local merge, a git graph annotated with agent status, and deep appearance customization with separate Latin/CJK fonts.

## 开发 / Development

需要 Node ≥ 22.12 和 macOS。Requires Node ≥ 22.12 on macOS.

```bash
npm install
npm run dev        # 启动开发版 / run the app with hot reload
npm run check      # typecheck + lint + unit tests
npm run test:e2e   # 构建并运行 Electron 冒烟测试 / build + Electron smoke test
npm run dist       # 打包 dmg + zip（arm64 + x64）到 release/ / build installers into release/
```

文档 / Docs：[PRD 与路线图](docs/PRD.md) · [产品简报](docs/product/product-brief.md) · [竞品调研](docs/research/2026-10-13-competitive-research.md) · [参与贡献](CONTRIBUTING.md)

## 安装 / Install

**要求 / Requirements**：macOS 13 或更高（Apple 芯片或 Intel）；已安装并登录 [Claude Code](https://docs.claude.com/en/docs/claude-code) 和/或 [Codex](https://github.com/openai/codex) 命令行。
macOS 13+ (Apple Silicon or Intel), with the Claude Code and/or Codex CLI installed and signed in.

1. 到 [Releases](https://github.com/meloer101/terminal-reborn/releases) 下载：Apple 芯片选 `arm64`，Intel 选 `x64`；`.dmg` 或 `.zip` 任选。
   Download from Releases: `arm64` for Apple Silicon, `x64` for Intel; either `.dmg` or `.zip`.
2. 把 **Terminal Reborn** 拖进「应用程序」。
   Drag **Terminal Reborn** into Applications.
3. 在有 Apple Developer ID 之前，发布的版本只有 ad-hoc 签名，macOS 会因为下载隔离标记拒绝打开。首次打开前运行一次：
   Until releases are signed with a Developer ID, macOS refuses to open the downloaded app because of its quarantine flag. Run this once before the first launch:

```bash
xattr -cr "/Applications/Terminal Reborn.app"
```

   也可以先尝试打开一次，再到「系统设置 → 隐私与安全性」点「仍要打开」。
   Alternatively, try to open it once, then click "Open Anyway" in System Settings → Privacy & Security.

有新版本时应用会提示一次，点击通知打开发布页；它不会自动下载或安装，也没有任何遥测。
When a newer release exists the app shows one notification that opens the release page; nothing is downloaded or installed automatically, and there is no telemetry.

维护者发版流程见 [docs/releasing.md](docs/releasing.md)。 Maintainers: see [docs/releasing.md](docs/releasing.md).

## License

[MIT](LICENSE)
