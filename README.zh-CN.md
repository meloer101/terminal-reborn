<p align="center">
  <a href="https://wavi-pi.vercel.app/zh/"><img src="docs/assets/readme/banner.jpg" alt="Wavi" width="100%"></a>
</p>

<h3 align="center">一个人，多线程。</h3>

<p align="center">
  同时运行多个 Claude Code、Codex 的 macOS 终端。<br>
  每个 agent 在自己的 git worktree 里干活；Wavi 告诉你哪个在等你、<br>
  每个改了什么，再把好的结果在本地合并回去。
</p>

<p align="center">
  <a href="https://github.com/meloer101/terminal-reborn/releases/latest"><img src="https://img.shields.io/github/v/release/meloer101/terminal-reborn?style=flat-square&label=release&labelColor=1a1a1a&color=3a3a3a" alt="最新版本"></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-3a3a3a?style=flat-square&logo=apple&logoColor=white&labelColor=1a1a1a" alt="macOS 13+">
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-3a3a3a?style=flat-square&labelColor=1a1a1a" alt="Claude Code 与 Codex">
  <img src="https://img.shields.io/badge/telemetry-none-3a3a3a?style=flat-square&labelColor=1a1a1a" alt="无遥测">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/meloer101/terminal-reborn?style=flat-square&labelColor=1a1a1a&color=3a3a3a" alt="MIT 许可"></a>
</p>

<p align="center">
  <a href="https://github.com/meloer101/terminal-reborn/releases/latest"><b>下载 macOS 版</b></a>
  &nbsp;·&nbsp; <a href="https://wavi-pi.vercel.app/zh/">官网</a>
  &nbsp;·&nbsp; <a href="CHANGELOG.md">更新记录</a>
  &nbsp;·&nbsp; <a href="docs/ROADMAP.md">路线图</a>
  &nbsp;·&nbsp; <a href="README.md">English</a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/hero-dark.png">
  <img src="docs/assets/readme/hero-light.png" alt="Wavi 侧栏里有六个 agent 会话。Claude Code 在覆盖文件前请求确认，它在侧栏里变成“等你确认”；右侧 Git 图谱给每个 worktree 分支标上对应 agent 的状态。">
</picture>

<p align="center"><sub>真实的 Claude Code 会话在覆盖文件前请求确认，它在侧栏里变成“等你确认”；Git 图谱给每个 worktree 分支标上对应 agent 的状态。</sub></p>

## 为什么是 Wavi

跑一个 coding agent 很简单。跑五个，就是五个终端、五条互相踩脚的分支，还有一个在你忘掉的标签页里已经等了十分钟的权限确认。

Wavi 让每个 agent 留在它自己的终端界面里，和 CLI 原本的样子一样，你照常在里面输入和作答。Wavi 补上旁边那些带团队的活：现在谁需要你，每个 worktree 改了什么，测试过没过，以及怎样在不弄坏 `main` 的前提下把最好的结果合并回去。

## 工作流程

<img src="docs/assets/readme/workflow.jpg" alt="Git 图谱上的六步：启动 agent、在各自的 worktree 里并行、提前发现冲突、审阅、合并、收尾。worktree 删掉，分支保留。">

## 功能

### 谁在等你，一眼就知道

每个会话用图形加文字显示状态，从不只靠颜色；旁边是当前动作（“编辑 auth.ts”“运行 pnpm test”）和已经等了多久。总览（<kbd>⇧⌘A</kbd>）跨项目按需要你做什么分组：等你处理、出错、待审阅、运行中、空闲。agent 请求权限时有系统通知和 Dock 角标，<kbd>⌘J</kbd> 跳到下一个需要你的会话。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/overview-dark.png">
  <img src="docs/assets/readme/overview-light.png" alt="总览把六个会话按状态分组：一个出错，一个待审阅，四个运行中。">
</picture>

### 一个 agent 一个 worktree，或者一个任务交给几个 agent

<kbd>⌘N</kbd> 在后台新建 worktree，按 `.worktreeinclude` 复制被 git 忽略的文件（如 `.env`），在里面启动 Claude Code、Codex 或普通终端。选“多个”，就把同一个任务同时交给 2–4 个 agent，Claude Code 和 Codex 可以混着来；每份都在同一个基线上有自己的 worktree。做完后并排比较，合并最好的那一份。

<img src="docs/assets/readme/compare.jpg" alt="同一个任务的三份结果并排比较：改动行数、测试、类型检查和 lint 结果，每份都能直接合并。">

### 审阅 diff，在行上回话

变更面板按未提交 / 已提交显示相对基线的改动，统一或并排。在任意一行写评论，Wavi 把评论合成一条带代码引用的说明，放进 agent 的输入行。也可以让 agent 做一次只读审阅，还可以让另一家来审（Codex 审 Claude 写的，反之亦然），发现的问题按 P0–P3 变成同样的行内评论。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/review-dark.png">
  <img src="docs/assets/readme/review-light.png" alt="变更面板里的 CSS diff，第 4 行有一条行内评论，可以发给 Claude。">
</picture>

### 本地合并，失败也不留半截

<kbd>⇧⌘M</kbd> 先检查领先 / 落后、冲突和未提交的改动，有 `test` 脚本时先跑它；然后选 squash、merge 或 rebase。合并在内存里完成，基线分支到最后一步才前移，失败时仓库保持原样。后台的冲突雷达把活跃的 worktree 两两比对、并和基线比对，在两个 agent 撞车之前提醒你。

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/new-session-dark.png">
        <img src="docs/assets/readme/new-session-light.png" alt="新建会话面板：同一个任务交给两份 Claude Code 和一份 Codex。">
      </picture>
      <p align="center"><sub><kbd>⌘N</kbd> 一个任务，三个 worktree：两份 Claude Code，一份 Codex</sub></p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/merge-dark.png">
        <img src="docs/assets/readme/merge-light.png" alt="合并面板：领先 main 2 个提交，选中 squash，合并后删除 worktree、保留分支。">
      </picture>
      <p align="center"><sub><kbd>⇧⌘M</kbd> 先检查再合并，分支保留</sub></p>
    </td>
  </tr>
</table>

**同一条链路上的还有**

- **PR**：创建 PR 时附上这一轮的检查和审阅作为证据；PR 上没解决的评论回到对应的行上；在 GitHub 合并时锁定你审阅过的那个提交。
- **这一轮的检查**：agent 这一轮跑过哪些测试、lint、类型检查，是否通过。从 hook 读出，不花 token。
- **归档**：停掉会话，未提交的改动存进私有 ref，把 worktree 收起；之后恢复，agent 接上原来的对话。

### 一个像样的终端该有的

- **agent 比窗口活得久。** 所有 PTY 由后台守护进程托管：关窗口或 <kbd>⌘Q</kbd> 之后 agent 继续运行，再打开时接回同一个进程和屏幕；<kbd>⌥⌘Q</kbd> 才结束所有会话。重启电脑后，你打开某个会话时它用 `--resume` 接上原来的对话。
- **agent 之间互相派活。** agent 可以开新的 Claude Code 或 Codex 会话，每个都在自己的 worktree 里、带着自己的任务，做完后结果回到派活的会话。每一批都先等你确认。
- **context 与额度。** 会话头显示 context 用了多少（以 agent 自己的自动压缩点为刻度）、todo 进度和 Claude / Codex 的额度窗口；用到 75%、90% 和用完时各提醒一次。
- **右侧栏。** 带 agent 状态的 Git 图谱、每个 worktree 一个内置浏览器（开发服务器和终端里的链接）、带预览的文件树。终端输出里的 `src/app.ts:42` 点一下就跳到那一行。
- **分屏与多窗口。** 2–4 个会话并排，或者把一个拖出去单独成窗口；重启后布局都会恢复。
- **把中文做对的终端。** xterm.js + WebGL 渲染；英文字体和中文字体分开设置，中文严格占两格；浅色 / 深色主题，<kbd>⌘K</kbd> 跳到任何地方，<kbd>⌘F</kbd> 搜索。

## 默认私密

- **不需要账号，没有服务器，没有遥测。** Wavi 每天问一次 GitHub 有没有新版本；除此之外只在你触发的 git 命令里联网，走你自己的 git 配置。
- **不改你的 agent 配置。** hooks 在每次启动时通过命令行参数传入（Claude 用 `--settings`，Codex 用 `-c`），从不写 `~/.claude/settings.json` 或 `~/.codex/`。Wavi 不绕过 Codex 的 hook 信任，只按 hash 信任它自己的那几条。
- **不替你花 token。** 行内评论、冲突说明和 `/compact` 都只放进 agent 的输入行，由你按回车。会自动花额度的功能（比如合并前自动审阅）都在设置 · 自动化里，默认关闭。
- **不用 `git stash`。** 归档的改动存进 `refs/wavi/archive/<id>`，不会碰到其他 worktree 的 stash 列表。

## 安装

1. 在 [Releases](https://github.com/meloer101/terminal-reborn/releases/latest) 下载 dmg：Apple 芯片选 `arm64`，Intel 选 `x64`。
2. 打开 dmg，把 Wavi 拖进「应用程序」。发布版用 Developer ID 签名并经过 Apple 公证。
3. 安装并登录 [Claude Code](https://docs.claude.com/en/docs/claude-code) 或 [Codex](https://github.com/openai/codex) 命令行。都没装也能当普通终端用。

需要 macOS 13 或更高。有新版本时 Wavi 会提醒你，下载后覆盖安装即可。

## 支持的 agent

| | 状态与通知 | context 与额度 | 审阅、派活、恢复 |
|---|:---:|:---:|:---:|
| **Claude Code** | ✓ | ✓ | ✓ |
| **Codex** | ✓ | ✓ <sup>1</sup> | ✓ |
| 其他 CLI | 在普通终端会话里运行 | – | – |

<sup>1</sup> Codex 的额度还没有在真实 ChatGPT 账号上验证过；用 API key 登录时 Codex 只提供 context。

## 常见问题

<details>
<summary><b>和 tmux、终端标签页有什么不同？</b></summary>
<br>
标签页只给你看终端。Wavi 知道每个终端里的 agent 在做什么：它读 agent 自己的 hook，分得清在等你、在运行还是做完了；git 那一侧也归它管，包括 worktree、diff、审阅、合并和归档。你不用再挨个翻标签页。
</details>

<details>
<summary><b>Wavi 会把我的代码发到哪里吗？</b></summary>
<br>
不会。Wavi 没有服务器，你的代码只会去你的 agent 和 git 远程本来就会去的地方。额度读数由 CLI 用你自己的登录查询，不发模型请求。
</details>

<details>
<summary><b>会改动我的 Claude Code 或 Codex 配置吗？</b></summary>
<br>
不会。Wavi 需要的一切都在每次启动时通过命令行传入。在 Wavi 外面运行 <code>claude</code> 或 <code>codex</code>，一切照旧。
</details>

<details>
<summary><b>还不支持什么？</b></summary>
<br>
只有 macOS 版。状态、通知和各项指标只适配了 Claude Code 和 Codex。接下来要做什么见<a href="docs/ROADMAP.md">路线图</a>。
</details>

## 开发

需要 Node ≥ 22.12 和 macOS。

```bash
npm install
npm run dev          # 开发版，带热更新，用独立的 Wavi Dev 配置
npm run check        # typecheck + lint + 单元测试
npm run test:e2e     # 构建并运行 Electron 端到端测试
npm run dist         # 打包 arm64 / x64 的 dmg 和 zip 到 release/
```

产品要做成什么样见 [docs/PRD.md](docs/PRD.md)，进度见 [docs/ROADMAP.md](docs/ROADMAP.md)，其余见 [CONTRIBUTING.md](CONTRIBUTING.md)。遇到问题或想要某个功能，请[提交 issue](https://github.com/meloer101/terminal-reborn/issues/new/choose)，有中文模板；附上 Wavi、macOS、`claude --version` 和 `codex --version` 最有用。

## 许可

[MIT](LICENSE)。第三方代码和素材见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

<br>

<p align="center">
  <img src="docs/assets/readme/branch-out-merge-in.jpg" alt="Branch out. Merge in." width="100%">
</p>
