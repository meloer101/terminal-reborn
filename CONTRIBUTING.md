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

从 `main` 推一个 `v*` tag 即可。`.github/workflows/release.yml` 会构建 arm64 和 x64 的 `.dmg` 与 `.zip`，用 Developer ID 签名并经 Apple 公证，挂到一个 GitHub Release **草稿**上；发布草稿之前用户看不到。仓库里没配好签名 secrets 时流水线会直接失败（见下面的“签名和公证”）。

1. **改版本号**：`package.json` 的 `version`（SemVer，如 `0.2.0`、`0.2.0-beta.1`），然后运行 `npm install --package-lock-only` 同步 `package-lock.json`。
2. **改 `CHANGELOG.md`**：把 `[Unreleased]` 的条目移到新的 `## [x.y.z] - YYYY-MM-DD` 下（短句，中英文各一行），并更新底部的对比链接。流水线直接用这一节当发布说明，所以标题里必须有 `[x.y.z]`。同时在 `docs/ROADMAP.md` 的“当前位置”写上新版本。
3. **本地检查**：
   ```bash
   npm run check
   npm run test:e2e
   npm run dist:dir && npm run test:packaged
   ```
   `npm run dist` 会在 `release/<version>/` 下构建全部四个安装包（约 2 分钟）；`release/` 不进 git。本机没有 Developer ID 证书时它自动退回 ad-hoc 签名（见下面），本机能跑，但不能拿去分发。
4. **提交并打 tag**：
   ```bash
   git commit -am "chore(release): v0.2.0"
   git tag v0.2.0
   git push origin main v0.2.0
   ```
   tag 必须等于 `v` + `package.json` 的版本，否则流水线第一步就会停下。
5. **等流水线跑完**（Actions → Release，公证通常要 10–20 分钟）：`npm ci`、`npm run check`、`npm run dist`（签名并公证两个 .app）、公证并 staple 两个 dmg、`scripts/verify-mac-release.sh` 按 Gatekeeper 的方式检查全部四个包、启动打包版跑 `npm run test:packaged`，然后创建草稿，附件为 `Wavi-<version>-arm64.dmg / .zip` 和 `-x64.dmg / .zip`。任何一步失败都不会建草稿。
6. **读一遍说明后发布草稿**。带连字符的版本（`-beta.1`）会建成预发布版，应用内的更新检查会忽略它。

同一个 tag 重跑流水线会替换已有附件。要重做一个错误的 tag：删除草稿和 tag（`git push origin :refs/tags/v0.2.0`），修好后重新打。

**更新检查**：应用启动 10 s 后和之后每 24 h 请求一次 `https://api.github.com/repos/<owner>/<repo>/releases/latest`（owner / repo 取自 `package.json` 的 `repository`），每个新版本只提示一次。只有已发布、非草稿、非预发布的版本才算数。仓库改名时，同步改 `package.json` 的 `repository`、`homepage`，以及 `README.md`、`CHANGELOG.md` 里的链接。`TR_DISABLE_UPDATE_CHECK=1` 关闭后台检查。

**签名和公证**：发布版用 “Developer ID Application” 证书签名（hardened runtime），由 electron-builder 用 notarytool 公证并把票据 staple 到 .app，dmg 在流水线里另外公证、staple。下载后直接打开，不需要 `xattr -cr`。

- 需要的 5 个仓库 secrets（Settings → Secrets and variables → Actions）：`CSC_LINK`（.p12 的 base64）、`CSC_KEY_PASSWORD`（导出 .p12 时设的密码）、`APPLE_API_KEY`（App Store Connect API 密钥 `AuthKey_<id>.p8` 的全文）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。缺一个流水线就在构建前停下，不会发出未签名的版本。
- entitlements 在 `build/entitlements.mac.plist`（主程序，也是 PTY 守护进程：同一个可执行文件加 `ELECTRON_RUN_AS_NODE`）和 `build/entitlements.mac.inherit.plist`（helper、`pty.node`、`spawn-helper`）。只开了 V8 需要的 `allow-jit`，以及 apple-events / 麦克风 / 摄像头（终端里子进程的这些请求算在 Wavi 头上，hardened runtime 下没有 entitlement 会被直接拒绝）。没有 `disable-library-validation`：包里每个 Mach-O 都由同一个 Developer ID 签名。以后如果要加载包外的原生模块，才需要它。
- 本机：`npm run dist` / `dist:dir` 走 `scripts/dist.mjs`。环境变量里有 `CSC_LINK`，或登录钥匙串里有 Developer ID Application 证书，就用它签名（再设了 `APPLE_API_KEY`（.p8 的路径）/ `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` 才公证）；否则退回 ad-hoc 签名并关掉 hardened runtime（ad-hoc 没有 Team ID，library validation 会拒绝加载 Electron 自己的框架）。“Apple Development” 证书不算。`npm run app:install` 的链接版始终是 ad-hoc，不受影响。
- 检查一个发布目录或下载的包：`scripts/verify-mac-release.sh release/<version>`（要求 Developer ID、hardened runtime、staple 过的票据，以及 `spctl` 给出 `source=Notarized Developer ID`）。
- 自动更新还没做；要做再加 `electron-updater`，`publish:` 下已经配好了 GitHub provider。

**构建注意事项**：
- `npmRebuild: false`：node-pty 是 N-API 并自带各架构的 prebuilds；从源码重编会把宿主架构的 `build/Release/pty.node`（node-pty 优先用它）带进另一个架构的包。出于同样原因，`node-pty/build` 不进包。
- `build/after-pack.cjs` 在签名前给包内的 `spawn-helper` 加执行位。`src/pty-host` 里的运行时补救只在开发时用。
- hook 脚本作为 extra resource 放在 `Contents/Resources/hooks/tr-hook.sh`（`src/main/hooks` 的 `hookScriptPath()`）。
- PTY 守护进程依赖 Electron 的 `runAsNode` fuse 保持开启（electron-builder 默认不动它）。
- 图标母版是 `build/icon.svg`，`npm run icon` 重新生成 `build/icon.icns` 和 `build/icon.png`。

## English

Read docs/PRD.md (what the product should become), docs/ROADMAP.md (what is done) and CLAUDE.md first. Branch from `main`, run `npm run check` before pushing, use Conventional Commits, and include dark + light screenshots for UI changes. Only adapt code from MIT / Apache-2.0 / BSD sources and record it in THIRD_PARTY_NOTICES.md. Maintainers release by bumping `package.json`, moving the `[Unreleased]` CHANGELOG entries under `[x.y.z]`, and pushing a matching `v*` tag; the workflow drafts a GitHub Release to publish by hand (details above).
