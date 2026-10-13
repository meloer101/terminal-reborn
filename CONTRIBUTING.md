# 参与贡献 / Contributing

谢谢你愿意帮忙！开始前请先读 [docs/PRD.md](docs/PRD.md)，以及仓库根目录的 [CLAUDE.md](CLAUDE.md)（里面有目录分工和约定，对人和 agent 都适用）。

## 流程

1. 先开 issue 讨论较大的改动。
2. 从 `main` 拉分支，命名 `<你的名字>/<简短描述>`。
3. 提交前运行 `npm run check`，涉及界面时运行 `npm run test:e2e`。
4. 提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat(composer): …`、`fix(pty): …`。
5. PR 描述写清楚改了什么、为什么、怎么验证。界面改动附截图（深色 + 浅色）。

## 约定

- 颜色、间距、字体只能用 `src/renderer/styles/tokens.css` 里的变量；新增 token 需要同步到 Figma。
- 改 `src/shared/` 下的接口属于跨模块改动，请在 PR 里单独说明。
- 借用其他项目的代码只限 MIT / Apache-2.0 / BSD，并登记到 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 界面文案用中文；代码、注释、提交信息用英文。

## English

Read docs/PRD.md and CLAUDE.md first. Branch from `main`, run `npm run check` before pushing, use Conventional Commits, and include dark + light screenshots for UI changes. Only adapt code from MIT / Apache-2.0 / BSD sources and record it in THIRD_PARTY_NOTICES.md.
