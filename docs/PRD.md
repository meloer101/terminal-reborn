# TerminalReborn PRD 与开发路线图

> 版本 v1.0 · 2026-10-13 · 状态：待评审
> 关联：[产品简报](product/product-brief.md) · [竞品调研](research/2026-10-13-competitive-research.md) · [Figma 设计稿](https://www.figma.com/design/x6HGsLiMTk7fWDoKI5YkKh/coding-terminal)

## 1. 背景与目标

### 1.1 问题
同时运行 3–10 个 Claude Code / Codex 的开发者每天都会遇到这些问题：
1. agent 的 TUI 输入框无法像正常编辑器那样选中删除，中文输入法下回车还会误发；
2. 不知道哪个 agent 正在等自己处理，常常让 agent 空等很久；
3. worktree 的创建、审阅、本地合并、冲突处理和清理分散在多个工具里；
4. 看不到"哪个分支、哪个 worktree、对应哪个 agent"的全貌；
5. 终端外观难以定制，没有一款工具能分别设置英文字体和中文字体。

调研结论：每个问题都有产品做得不错，但没有一个产品把它们同时解决（见调研报告 §0）。

### 1.2 产品目标
在保留 agent 原生 TUI 的前提下，补齐五件事：**常驻桌面级输入栏**、**agent 状态与即时回复**、**本地 worktree 全链路**、**带 agent 状态的 git 图谱**、**可深度定制且对中文友好的外观**。

### 1.3 成功指标

| 指标 | 目标 |
|---|---|
| 输入栏送达率 | 发送协议测试矩阵（ASCII、中文、2 万字符、`/`、`#`、图片、agent 忙时插话）100% 送达，无吞回车、无多余占位符 |
| "等你处理"感知延迟 | 从 hook 事件到侧栏置顶 + 系统通知 ≤ 1 s |
| 状态准确性 | 连续使用 1 周，状态卡死（显示错误超过 2 分钟）次数为 0 |
| 中文输入 | 选字过程中按回车不会误发；CJK 字符在终端中严格占 2 个单元格 |
| 合并闭环 | 从会话完成 → 审阅 → 本地合并 → 清理 worktree，全程不离开应用 |
| 性能 | 冷启动 ≤ 2 s；10 个活跃会话时输入延迟 < 16 ms；常驻内存 < 1.5 GB |
| 作者自用 | M2 结束后，作者日常完全用 TerminalReborn 代替 Terminal / Orca |

### 1.4 非目标（v1.0 之前不做）
- 用自绘聊天 GUI 替代 agent 的 TUI（headless / stream-json 路线）
- Windows / Linux
- 账号、云同步、默认开启的遥测
- 内置代码编辑器或 IDE 功能（diff 只做审阅和评论，不做编辑）
- 远程 / SSH 会话
- GitHub PR 流程（放到 M6）

## 2. 用户与核心场景

**目标用户**：在 macOS 上同时运行多个 CLI coding agent、每个 agent 各占一个 git worktree 的开发者。很多人用中英文混合写 prompt。

**核心链路**：沿用产品简报中的 L1–L7（开新任务 · 输入与发送 · 被需要时 · 审阅与合并 · 冲突 · Git 全景 · 外观定制），本文不再重复，验收标准见 §4。

## 3. 对象模型与状态机

```
Project（git 仓库根目录）
 └─ Worktree（branch · path · baseBranch · ahead/behind · dirty · +N −M）
     └─ Session（kind: claude | codex | shell · status · title · currentAction · startedAt · ptyId）
```

### 3.1 会话状态

| 状态 | 含义 | 进入信号（优先级从高到低） |
|---|---|---|
| `running` 运行中 | agent 正在工作 | hook `UserPromptSubmit` / `PreToolUse` / `PostToolUse`；标题出现 spinner 字符 |
| `needs_you` 等你处理 | 等待权限确认或回答提问 | hook `PermissionRequest`、`Notification(permission_prompt / elicitation_dialog)`、AskUserQuestion 对应的 `PreToolUse` |
| `done_unread` 已完成·未读 | 一轮对话结束，用户还没看 | hook `Stop`，且该会话当前不可见 |
| `idle` 空闲 | 已完成且已看过，或刚启动 | 用户看过 `done_unread` 的会话；`SessionStart` |
| `error` 出错 | 本轮失败 | hook `StopFailure`；进程非零退出 |
| `exited` 已退出 | 进程已结束 | PTY exit / `SessionEnd` |

- `needsAttention = needs_you || error || done_unread`，侧栏顶部队列按这个条件筛选。
- **自愈**：hook 可能丢事件，所以每 5 s 检查一次进程是否存活。`running` 状态超过 3 分钟没有收到任何 hook，且标题显示空闲字符（Claude 为 `✳`）时，降级为 `idle`；`needs_you` 被用户在 TUI 中直接回答后（随后收到 `PostToolUse` 或 `UserPromptSubmit`），立即恢复为 `running`。
- 状态从不只靠颜色表达：每种状态都有独立的 StatusGlyph 形状和文字。

### 3.2 当前动作
由 `PreToolUse` 的 `tool_name` + `tool_input` 生成，例如 "编辑 auth.ts"、"运行 pnpm test"、"搜索 'useSession'"。没有 hook 时显示为空。

## 4. 功能需求

优先级：**P0** = MVP 必须有 · **P1** = v0.x 公开版本 · **P2** = v1.0 之前。

### F1 输入栏 Composer · P0 · Figma 01（Composer、Selection）
- 原生多行编辑：支持选中、⌘A、⌘⌫、⌥⌫、撤销/重做、在任意位置插入。↵ 发送，⇧↵ 换行。
- 输入法安全：`isComposing` 为真、`keyCode === 229` 或 `key === 'Process'` 时，回车不触发发送。
- 草稿按会话保存，切换会话和重启应用后都能恢复。Esc 不清空草稿。
- **直通**：输入栏为空时，Esc、↑、↓、⇧Tab、Ctrl+C 直接转发给 agent。
- 拖入图片或文件：存为临时文件，以 bracketed paste 写入**路径**。
- `@` 引用文件：在 worktree 内做模糊搜索（P1）。
- **发送协议**（`src/shared/send-protocol.ts`，纯函数，可单元测试）：
  1. 每个 PTY 一个串行发送队列；
  2. 首字符是 `/` 或 `#` 时单独作为按键写入；不带参数的 slash 命令末尾补一个空格；
  3. 正文用 `ESC[200~ … ESC[201~` 包起来写入；
  4. 闭环确认：在 xterm buffer 中看到正文或 `[Pasted text` 占位符后，才进入下一步；超时时间按 **UTF-8 字节数**计算；
  5. 回车 `\r` **单独写一次**；对 Codex 额外等待至少 150 ms（避开它 120 ms 的粘贴突发窗口）；
  6. agent 正忙时发送，视为插话（steer）。
- 终端内键位补充：⌘⌫ → Ctrl+U，⌘← / ⌘→ → Ctrl+A / Ctrl+E，⌥← / ⌥→ → ESC b / ESC f。
- **验收**：§1.3 的测试矩阵在 Claude 和 Codex 上全部通过；搜狗和系统拼音输入法下，选字时回车不会误发。

### F2 状态侧栏 · P0 · Figma 01 / 02（Sidebar、SessionRow、NavItem）
- 项目 › worktree › 会话三级树；顶部"等你处理"队列。
- 每行显示：StatusGlyph、任务标题（默认为首条 prompt，可重命名）、当前动作、`+N −M`、耗时。
- 系统通知：只在窗口失焦或该会话不可见时发送，点击后跳到对应会话。Dock 角标显示 `needsAttention` 的数量。
- 快捷键：⌘1–9 切换会话，⌘J 跳到下一个需要处理的会话。
- **验收**：Figma 01 / 02 的侧栏在深色和浅色模式下像素级还原；同时运行 10 个会话时，状态变化在 1 s 内反映到侧栏。

### F3 即时回复 · P0（Claude）/ P1（Codex）· Figma 02（PromptBar）
- **权限确认**：采用阻塞式 hook。hook 进程挂起，等待 GUI 返回 `{behavior: allow | deny}`，提供"允许一次 / 总是允许 / 拒绝"三个选项；120 s 超时后返回 `{}`，交回 TUI 原生提示处理。两边任何一方作答后，另一方立即撤下提示。
- **AskUserQuestion**：从 hook 的 `tool_input` 获取选项结构，用户点击后向 PTY 发送按键序列：单选直接按数字；多选按数字切换后 → Enter；"其他"选 N+1 后输入文本再 Enter。屏幕上识别 `❯ 1.` 编号菜单作为没有 hook 时的兜底。
- 作答方式：点击按钮；或在选项条可见、输入栏为空时直接按 1–9；输入栏有内容时按 ⌥1–9。
- 侧栏内联回复：在侧栏行内展开选项或输入框，无需切换会话（P1）。
- **验收**：Figma 02 的完整流程跑通；GUI 和 TUI 同时作答不会产生重复按键。

### F4 Worktree 生命周期 · P1 · Figma 06（New task sheet）/ 05（Merge sheet）
- 新建任务 ⌘N：选择项目和基线分支 → 输入任务描述 → 自动生成分支名（`<前缀>/<slug>`，中文标题回退为拼音或时间戳，可手动修改）→ 选择 agent → ↵。
- 后台执行：`git fetch` → `git worktree add --no-track -b <branch> ~/.tr/worktrees/<repo>/<name> <base>` → 记录 `branch.<name>.base` → 按 `.worktreeinclude` 用 `cp -c`（APFS 写时复制）复制被忽略文件 → 在可见终端里运行 setup 脚本 → 启动 agent 并送入首条 prompt。
- 本地合并：预检（落后基线的提交数、`git merge-tree --write-tree` 冲突检测、可选测试命令）→ 选择 merge `--no-ff` / squash / rebase + `--ff-only` → 可选"合并后删除 worktree（保留分支）"和"推送到 origin"。
- 冲突处理：列出冲突文件和原因 →「交给 agent 解决」会自动生成说明（冲突类型、分支、文件列表、提醒设置 `GIT_EDITOR=true`）并发送到该会话；或者选择「中止」。能识别仓库处于 merge / rebase / cherry-pick 进行中的状态。
- 清理：合并后提示删除；列出孤儿 worktree（P2：按 TTL 自动回收）。
- **验收**：在测试仓库上完成 L1 / L4 / L5 全流程；合并失败时仓库能回到干净状态。

### F5 Diff 审阅 · P1 · Figma 03（Panel · 变更）
- 右侧面板"变更"页：对比基线的文件列表、汇总 `+N −M`，支持 unified / split 视图（`@pierre/diffs`）。
- 行内评论：多条评论可以合并为一条 prompt，一键发给该会话的 agent。
- 底部操作：发送评论 · 放弃 · 合并到 main。
- **验收**：Figma 03 还原；1 万行 diff 滚动流畅。

### F6 Git 图谱 · P1 · Figma 04（Panel · 图谱）
- 自研 lane 算法（`src/shared/git-graph/lanes.ts`，O(n·lanes)，支持增量分页）；每行用 SVG 绘制，`@tanstack/react-virtual` 做虚拟化。
- 在提交行上标出每个 worktree 的 HEAD，以及对应 agent 的 StatusGlyph，点击跳到该会话。
- 筛选：全部分支 / 仅 worktree。
- 右键菜单：切换到会话 · 合并到基线 · 基于基线 rebase · 复制 SHA · 新建 worktree · 删除 worktree。
- 下方的 Worktree 列表：名称、路径、↑↓、更多操作。
- **验收**：Figma 04 还原；5000 个提交的仓库首屏 < 300 ms。

### F7 外观 · P0（主题 token）/ P1（设置页）· Figma 07 / 08
- 深色和浅色两套主题，token 来自 Figma 变量（Color：bg / text / border / status / diff / term / lane；Layout：space / radius），导出为 CSS 变量。
- **英文字体和中文字体分别设置**：xterm 的 `fontFamily` 为 `"<英文>", "<中文>", monospace`，开启 `rescaleOverlappingGlyphs`；字体加载完成后执行 `clearTextureAtlas()`。
- 字号、行高、连字；背景（纯色 / 渐变 / 图片，采用 CSS background 语义）；终端不透明度；侧栏毛玻璃（`vibrancy: 'sidebar'`，终端区域保持不透明）。
- 设置页右侧实时预览；P2 支持导入 Ghostty / iTerm 主题。
- **验收**：Figma 07 / 08 还原；修改设置后，所有终端在 100 ms 内生效，且不需要重启会话。

### F8 全局 · P1
- ⌘K 命令面板（会话、项目、操作）· ⌘, 设置 · ⌘\ 收起或展开侧栏 · ⌘⌥B 收起或展开右侧面板。
- 键盘可以完成所有高频操作；支持减少动态效果；文字和状态的对比度达到 WCAG 2.2 AA。

## 5. 设计规范

- 唯一的设计来源是 Figma 文件中的 Foundations、Components、Screens 三页。屏幕节点：01 运行中 `14:2` · 02 等你处理 `16:178` · 03 变更审阅 `16:405` · 04 Git 图谱 `18:591` · 05 合并预检 `19:814` · 06 新任务 `19:940` · 07 设置·外观 `21:1223` · 08 浅色模式 `24:1790`。
- 字体：UI 使用系统字体 SF Pro（Figma 中的 Instrument Sans 只是替身）；等宽字体默认 JetBrains Mono；中文默认思源黑体 SC / 苹方，并逐段显式指定。
- 风格约束：零彩度中性色；颜色只用于表达状态；用排版、对齐和细分隔线建立层级；小圆角（3 / 5 / 窗口 10）；不使用卡片堆叠、渐变或装饰性小字。
- 每个组件实现时，用 Figma MCP 的 `get_design_context` 读取对应节点，并配合 Code Connect 映射。

## 6. 技术架构

### 6.1 进程模型
```
Main（Electron 主进程）
 ├─ AppState：项目 / worktree / 会话元数据（JSON，存于 ~/Library/Application Support/TerminalReborn）
 ├─ HookServer：Unix socket 接收 hook 事件 → 状态机 → 通过 IPC 推送给 renderer
 ├─ GitService：调用 git CLI 子进程（不用 libgit2）
 └─ WorktreeService / Notifications / Dock badge
PtyHost（utilityProcess）：node-pty 会话池；输出批量转发；串行发送队列
Renderer（React 19 + zustand）：侧栏 · TerminalSurface(xterm.js) · Composer · 右侧面板 · 设置
```

### 6.2 Hooks 注入（不修改用户的全局配置）
- 应用自带 `resources/bin/claude`、`codex` 两个 wrapper，并把该目录加到 PTY 环境变量 PATH 的最前面。wrapper 通过 `--settings <生成的 json>` 注入 hooks；如果用户自己也传了 `--settings`，先把两者深合并，保证命令行上只有一个 `--settings`。
- hook 命令是一个很小的脚本：读取 stdin 的 JSON，附上 `TR_SESSION_ID` 和 nonce，发送到 HookServer；socket 不可用时写入 spool 文件，之后补发。
- 启动 agent 前预先写好目录信任标记（Claude：`hasTrustDialogAccepted`），避免首条 prompt 被信任弹窗吃掉。
- Codex 的 hook 信任方式（是写入 `trusted_hash`，还是使用 `--dangerously-bypass-hook-trust`）在 M3 的预研中决定。

### 6.3 终端
- 定义 `TerminalSurface` 接口（write / onData / buffer 读取 / OSC 订阅 / resize），xterm.js 是它的第一个实现，以后可以替换为 libghostty。
- xterm 配置：使用 WebGL 渲染，失败时**按终端**回退到 DOM 渲染；开启 unicode11；纹理图集定期重置；kitty 键盘协议保持关闭；切换标签或面板后强制执行 fit + resize。

### 6.4 目录结构
```
src/main/        app, windows, ipc, hook-server, git/, worktree/, settings/, notifications
src/pty-host/    pty pool, send queue
src/preload/
src/renderer/    app-shell, sidebar, terminal, composer, panels/{changes,graph}, settings, tokens.css
src/shared/      types, session-state-machine, send-protocol, git-graph/lanes, worktree-porcelain-parser, branch-naming
resources/bin/   claude / codex wrapper, hook script
```
`src/shared` 中都是纯逻辑，全部用 Vitest 覆盖。

### 6.5 可借鉴代码（仅限 MIT / Apache 许可）
Orca：IME 处理、AskUserQuestion 按键序列、worktree porcelain 解析、`.worktreeinclude`。Nimbalyst：`claudeCliSubmit.ts` 发送规则。Vibe Kanban / Crystal：合并预检和冲突 prompt。借用代码时在文件头注明出处和许可证。cmux / Warp / Superset / vscode-git-graph 只参考思路，不复制代码。

## 7. 开源与工程规范

- 许可证：**MIT**（与主要借鉴来源兼容）。仓库公开，包含 README（中英文）、CONTRIBUTING、CODE_OF_CONDUCT、issue / PR 模板，以及第三方许可证清单 `THIRD_PARTY_NOTICES`。
- CI（GitHub Actions）：typecheck · ESLint · Vitest · Playwright（`_electron`）冒烟测试 · electron-builder 打包。
- 发布：Developer ID 签名 + 公证（**需要作者自行准备 Apple Developer 账号**），通过 electron-updater + GitHub Releases 自动更新，同时提供 arm64 和 x64 两个架构。
- 隐私：默认不收集任何遥测数据；崩溃上报为可选项，需用户主动开启。
- 版本：遵循 SemVer，维护 CHANGELOG。

## 8. 开发路线图

每个里程碑都以"能实际使用的产物 + 完成标准"收尾。工期按"1 名开发者 + Claude"估算，仅作参考。

### M0 · 工程地基与技术预研（约 1 周）
- 用 electron-vite 重新搭建脚手架（复用现有 `package.json` 的依赖，清理之前未完成的安装）；确定使用 xterm 6.0 还是 6.1 beta。
- 公开仓库所需的基础设施：MIT 许可证、README、CI 流水线、Vitest、Playwright。
- 把 Figma 变量导出为 `tokens.css`（深色 + 浅色）；搭出应用外壳（侧栏 + 主区 + 右侧面板的空骨架）。
- **预研**（结果写入 `docs/spikes/`）：① Claude 2.1.x 下 `\r` 与 Ctrl+Enter 的区别，以及 `<pasted_content>` 包裹对指令遵循的影响；② Codex 粘贴突发窗口和 `disable_paste_burst`；③ `--settings` 合并行为，以及与本机 Orca 全局 hooks 共存时的表现。
- **完成标准**：窗口中能运行 zsh；CI 全绿；三份预研结论已落档。

### M1 · 终端 + 输入栏（约 2 周）→ 可以日常使用
- PtyHost、多会话、TerminalSurface、xterm 配置、键位映射。
- F1 输入栏全部功能（`@` 引用除外），发送协议有单元测试覆盖。
- 手动添加项目和会话（暂不涉及 worktree），按会话保存草稿。
- **完成标准**：作者可以用它代替 Terminal.app 驱动 Claude Code；发送测试矩阵全部通过；Figma 01 的主区还原。

### M2 · 状态与即时回复（Claude）（约 2 周）→ **MVP**
- wrapper + HookServer + 状态机 + 自愈逻辑；F2 侧栏、通知、Dock 角标。
- F3 权限卡片（阻塞式 hook）+ AskUserQuestion 点选 + 数字键作答；⌘K 基础版。
- **完成标准**：Figma 01 / 02 全部还原；连续自用 1 周没有出现状态卡死。

### M3 · 外观设置 + Codex 适配（约 1.5 周）→ **v0.1.0 首个公开发布**
- F7 设置页（中英文字体分别设置、背景、毛玻璃、浅色模式、实时预览）。
- Codex：wrapper、hooks 信任方案、发送策略、选项点选。
- 签名、公证、自动更新跑通。
- **完成标准**：Figma 07 / 08 还原；Claude 和 Codex 都通过 M1 / M2 的验收；发布 v0.1.0。

### M4 · Worktree 全链路 + Diff 审阅（约 2.5 周）→ v0.2.0
- F4 新建任务、`.worktreeinclude`、setup 脚本、合并预检、merge / squash / rebase、冲突交给 agent、清理。
- F5 变更面板 + 行内评论发给 agent。
- **完成标准**：Figma 03 / 05 / 06 还原；L1 / L4 / L5 完整跑通；git 相关操作有基于临时仓库的集成测试。

### M5 · Git 图谱（约 1.5 周）→ v0.3.0
- F6 lane 算法、worktree / agent 标注、右键操作、虚拟化、Worktree 列表。
- **完成标准**：Figma 04 还原；5000 个提交的仓库性能达标。

### M6 · 深化（持续进行）→ v1.0
- 会话在应用重启后保留（PTY 守护进程 + `claude --resume`）；侧栏内联回复；`@` 文件引用。
- GitHub PR 流程（`gh`）；checkpoint；导入 Ghostty / iTerm 主题；多会话总览网格；孤儿 worktree 自动回收。
- **v1.0 标准**：§1.3 的所有指标达标；没有 P0 / P1 缺陷。

### 里程碑与设计稿对照

| Figma 屏幕 | 里程碑 |
|---|---|
| 01 运行中 | M1（主区）+ M2（侧栏） |
| 02 等你处理 | M2 |
| 03 变更审阅 | M4 |
| 04 Git 图谱 | M5 |
| 05 合并预检·冲突 | M4 |
| 06 新任务 | M4 |
| 07 设置·外观 | M3 |
| 08 浅色模式 | M3（token 在 M0 就位） |

## 9. 风险与待定项

| 风险 / 待定项 | 应对 | 何时决定 |
|---|---|---|
| 发送协议在不同 Claude / Codex 版本下表现不同 | M0 预研 + 按 CLI 版本区分发送策略 + 回归测试矩阵 | M0 |
| hook 丢事件导致状态卡死 | 检查进程存活、超时降级、标题兜底 | M2 |
| Codex hook 信任机制 | 先预研，再在 trusted_hash 和 bypass 之间二选一 | M3 |
| xterm.js 透明背景有渲染 bug | 终端区域默认不透明，只给侧栏加毛玻璃 | M3 |
| 与本机已安装的 Orca 全局 hooks 冲突 | 用 `TR_SESSION_ID` 区分来源，忽略其他来源的事件 | M0 |
| Apple Developer 账号 | 作者准备；拿到之前先发布未签名的 alpha | M3 前 |
| 许可证合规 | 在 THIRD_PARTY_NOTICES 中逐文件登记借用的代码 | 持续 |
