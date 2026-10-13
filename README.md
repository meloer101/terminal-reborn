# Terminal Reborn

一个为并行运行多个 CLI coding agent（Claude Code、Codex）而做的 macOS 终端。
A macOS terminal for running many CLI coding agents in parallel.

> 状态：开发早期（M0）。还不能日常使用。
> Status: early development (M0). Not usable yet.

它保留 agent 原生的终端界面，并在其上补齐：

- **真正的输入栏**：可以选中删除、中文输入法安全、按会话保存草稿
- **状态侧栏**：每个 agent 在做什么、哪个在等你，一眼可见；权限确认和选项一键作答
- **Worktree 全链路**：一步开新任务，本地合并前预检冲突，冲突可以交给 agent 解决
- **Git 图谱**：在提交图上标出每个 worktree 及其 agent 状态
- **外观**：英文和中文字体分别设置，背景、主题、浅色模式

It keeps each agent's native TUI and adds a real text editor for prompts, an at-a-glance status sidebar with one-click answers, the full worktree lifecycle with local merge, a git graph annotated with agent status, and deep appearance customization with separate Latin/CJK fonts.

## 开发 / Development

需要 Node ≥ 22.12 和 macOS。Requires Node ≥ 22.12 on macOS.

```bash
npm install
npm run dev        # 启动开发版 / run the app with hot reload
npm run check      # typecheck + lint + unit tests
npm run test:e2e   # 构建并运行 Electron 冒烟测试 / build + Electron smoke test
```

文档 / Docs：[PRD 与路线图](docs/PRD.md) · [产品简报](docs/product/product-brief.md) · [竞品调研](docs/research/2026-10-13-competitive-research.md) · [参与贡献](CONTRIBUTING.md)

## 安装未签名版本 / Installing unsigned builds

在有 Apple Developer ID 之前，发布的版本只有 ad-hoc 签名。下载后运行一次：
Until releases are signed with a Developer ID, clear the quarantine flag once after download:

```bash
xattr -cr "/Applications/Terminal Reborn.app"
```

## License

[MIT](LICENSE)
