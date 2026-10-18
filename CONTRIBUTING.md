# 参与贡献 / Contributing

谢谢你愿意帮忙！开始前请先读 [docs/PRD.md](docs/PRD.md)（产品要做成什么样）、[docs/ROADMAP.md](docs/ROADMAP.md)（做到哪了），以及仓库根目录的 [CLAUDE.md](CLAUDE.md)（里面有目录分工和约定，对人和 agent 都适用）。

## 流程

1. 先开 issue 讨论较大的改动。
2. 从 `main` 拉分支，命名 `<你的名字>/<简短描述>`。
3. 提交前运行 `npm run check`，涉及界面时运行 `npm run test:e2e`。
4. 提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat(sidebar): …`、`fix(pty): …`。
5. PR 描述写清楚改了什么、为什么、怎么验证。界面改动附截图（深色 + 浅色）。

## 约定

- 颜色、间距、字体只能用 `src/renderer/styles/tokens.css` 里的变量；新增 token 需要同步到 Figma。
- 改 `src/shared/` 下的接口属于跨模块改动，请在 PR 里单独说明。
- 借用其他项目的代码只限 MIT / Apache-2.0 / BSD，并登记到 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 界面文案用中文；代码、注释、提交信息用英文。
- 文档只有两份：产品决定改 `docs/PRD.md`，进度改 `docs/ROADMAP.md`。不要新建计划、任务单或验收文档。

## 维护者：发版

从 `main` 推一个 `v*` tag 即可。`.github/workflows/release.yml` 会构建 arm64 和 x64 的 `.dmg` 与 `.zip`（ad-hoc 签名），挂到一个 GitHub Release **草稿**上；发布草稿之前用户看不到。

1. **改版本号**：`package.json` 的 `version`（SemVer，如 `0.2.0`、`0.2.0-beta.1`），然后运行 `npm install --package-lock-only` 同步 `package-lock.json`。
2. **改 `CHANGELOG.md`**：把 `[Unreleased]` 的条目移到新的 `## [x.y.z] - YYYY-MM-DD` 下（短句，中英文各一行），并更新底部的对比链接。流水线直接用这一节当发布说明，所以标题里必须有 `[x.y.z]`。同时在 `docs/ROADMAP.md` 的“当前位置”写上新版本。
3. **本地检查**：
   ```bash
   npm run check
   npm run test:e2e
   npm run dist:dir && npm run test:packaged
   ```
   `npm run dist` 会在 `release/<version>/` 下构建全部四个安装包（约 2 分钟）；`release/` 不进 git。
4. **提交并打 tag**：
   ```bash
   git commit -am "chore(release): v0.2.0"
   git tag v0.2.0
   git push origin main v0.2.0
   ```
   tag 必须等于 `v` + `package.json` 的版本，否则流水线第一步就会停下。
5. **等流水线跑完**（Actions → Release）：`npm ci`、`npm run check`、`npm run dist`、校验两个架构的签名、启动打包版跑 `npm run test:packaged`，然后创建草稿，附件为 `Wavi-<version>-arm64.dmg / .zip` 和 `-x64.dmg / .zip`。
6. **读一遍说明后发布草稿**。带连字符的版本（`-beta.1`）会建成预发布版，应用内的更新检查会忽略它。

同一个 tag 重跑流水线会替换已有附件。要重做一个错误的 tag：删除草稿和 tag（`git push origin :refs/tags/v0.2.0`），修好后重新打。

**更新检查**：应用启动 10 s 后和之后每 24 h 请求一次 `https://api.github.com/repos/<owner>/<repo>/releases/latest`（owner / repo 取自 `package.json` 的 `repository`），每个新版本只提示一次。只有已发布、非草稿、非预发布的版本才算数。仓库改名时，同步改 `package.json` 的 `repository`、`homepage`，以及 `README.md`、`CHANGELOG.md` 里的链接。`TR_DISABLE_UPDATE_CHECK=1` 关闭后台检查。

**签名**：目前是 ad-hoc 签名（`identity: '-'`、hardened runtime、Electron 默认 entitlements，包括 node-pty 需要的 `disable-library-validation`）。`codesign --verify --deep --strict` 能通过，但下载后 Gatekeeper 会拦，所以 README 里要求运行一次 `xattr -cr`。以后换成 Developer ID（需要 Apple Developer 账号）：

1. 把 Developer ID Application 证书放进 CI 钥匙串（secrets `CSC_LINK`、`CSC_KEY_PASSWORD`），把 `electron-builder.yml` 里的 `identity: '-'` 换成证书名（或删掉让 electron-builder 自动查找）。
2. 在 `mac:` 下加 `notarize: true`，并把 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 作为 secrets 传给构建步骤。
3. 然后删掉 README 里的 `xattr` 步骤。要做真正的自动更新再加 `electron-updater`，`publish:` 下已经配好了 GitHub provider。

**构建注意事项**：
- `npmRebuild: false`：node-pty 是 N-API 并自带各架构的 prebuilds；从源码重编会把宿主架构的 `build/Release/pty.node`（node-pty 优先用它）带进另一个架构的包。出于同样原因，`node-pty/build` 不进包。
- `build/after-pack.cjs` 在签名前给包内的 `spawn-helper` 加执行位。`src/pty-host` 里的运行时补救只在开发时用。
- hook 脚本作为 extra resource 放在 `Contents/Resources/hooks/tr-hook.sh`（`src/main/hooks` 的 `hookScriptPath()`）。
- PTY 守护进程依赖 Electron 的 `runAsNode` fuse 保持开启（electron-builder 默认不动它）。
- 图标母版是 `build/icon.svg`，`npm run icon` 重新生成 `build/icon.icns` 和 `build/icon.png`。

## English

Read docs/PRD.md (what the product should become), docs/ROADMAP.md (what is done) and CLAUDE.md first. Branch from `main`, run `npm run check` before pushing, use Conventional Commits, and include dark + light screenshots for UI changes. Only adapt code from MIT / Apache-2.0 / BSD sources and record it in THIRD_PARTY_NOTICES.md. Maintainers release by bumping `package.json`, moving the `[Unreleased]` CHANGELOG entries under `[x.y.z]`, and pushing a matching `v*` tag; the workflow drafts a GitHub Release to publish by hand (details above).
