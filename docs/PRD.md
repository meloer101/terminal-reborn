# TerminalReborn PRD

> 版本 v1.5 · 2026-10-17 · 本文写**产品最终会长什么样**：目标、功能、设计和技术架构。做到哪了见 [ROADMAP](ROADMAP.md)。
> 维护规则：产品决定一变就改这里，并在“变更记录”里加一行。不再另建产品简报、调研、spike 或任务单；实测得到的技术结论压缩后写进 §6。
> 设计稿：[Figma](https://www.figma.com/design/x6HGsLiMTk7fWDoKI5YkKh/coding-terminal)

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.5 | 2026-10-17 | 新增 F17 右侧栏：浮在窗口上的一层，浏览器 · Git · Worktree · 文件四个视图，由会话头的图标切换（Figma 13）；内置浏览器从 P2 提前；F6 图谱是 Git 视图的默认内容、F5 变更是第二个视图，F6 的 Worktree 列表移到 Worktree 视图 |
| v1.4 | 2026-10-17 | F8：菜单中文化，⌘+ / ⌘- / ⌘0 调终端字号，快捷键集中定义；⌘F 查找条是终端上唯一的叠加控件（按需出现） |
| v1.3 | 2026-10-17 | 路线图和进度移到 ROADMAP；产品简报里的核心链路并入 §2；spike 的实测结论并入 §6.6–§6.9；其余文档删除 |
| v1.2 | 2026-10-16 | **终端就是全部界面**：取消 F1 输入栏和 F3 应用内作答（PromptBar），终端里不叠加任何控件；权限请求只用来标记“等你处理”，在 TUI 里作答；终端默认行高 1；终端底色只跟随浅色 / 深色主题，取消渐变 / 图片背景。PTY 守护进程：⌘Q 后 agent 继续运行（F8） |
| v1.1 | 2026-10-16 | 新增 §3.3 信息架构（侧栏层级规则，取消“等你处理”置顶队列）；F2 改写；新增 F9 状态总览与 F10–F16 |
| v1.0 | 2026-10-13 | 初版 |

## 1. 背景与目标

### 1.1 问题
同时运行 3–10 个 Claude Code / Codex 的开发者每天都会遇到这些问题：
1. agent 的 TUI 输入框无法像正常编辑器那样选中删除，中文输入法下回车还会误发；
2. 不知道哪个 agent 正在等自己处理，常常让 agent 空等很久；
3. worktree 的创建、审阅、本地合并、冲突处理和清理分散在多个工具里；
4. 看不到“哪个分支、哪个 worktree、对应哪个 agent”的全貌；
5. 终端外观难以定制，没有一款工具能分别设置英文字体和中文字体。

每个问题都有产品做得不错，但没有一个产品把它们同时解决。

### 1.2 产品目标
在保留 agent 原生 TUI 的前提下，补齐四件事：**agent 状态与跨项目总览**、**本地 worktree 全链路**、**带 agent 状态的 git 图谱**、**可深度定制且对中文友好的外观**。（v1.2 起不做应用内输入栏。）

### 1.3 成功指标

| 指标 | 目标 |
|---|---|
| “等你处理”感知延迟 | 从 hook 事件到侧栏 / 总览 + 系统通知 ≤ 1 s |
| 状态准确性 | 连续使用 1 周，状态卡死（显示错误超过 2 分钟）次数为 0 |
| 中文 | CJK 字符在终端中严格占 2 个单元格；中英文字体可分别设置 |
| 会话不丢失 | 关窗口、⌘Q、重启应用都不中断 agent；重启电脑后能接上原对话 |
| 合并闭环 | 从会话完成 → 审阅 → 本地合并 → 清理 worktree，全程不离开应用 |
| 性能 | 冷启动 ≤ 2 s；10 个活跃会话时输入延迟 < 16 ms；常驻内存 < 1.5 GB |
| 作者自用 | 作者日常完全用 TerminalReborn 代替 Terminal / Orca |

### 1.4 非目标（v1.0 之前不做）
- 用自绘聊天 GUI 替代 agent 的 TUI（headless / stream-json 路线）
- Windows / Linux
- 账号、云同步、默认开启的遥测
- 内置代码编辑器或 IDE 功能（diff 只做审阅和评论，不做编辑）
- 远程 / SSH 会话

## 2. 用户与核心场景

**目标用户**：在 macOS 上同时运行多个 CLI coding agent、每个 agent 各占一个 git worktree 的开发者。很多人用中英文混合写 prompt。

**设计原则**：终端优先，界面其余部分退后；只在需要你时打扰，“等你处理”是唯一高亮的状态；所有高频操作都能用键盘完成；用排版层级、对齐和分隔线组织信息，不靠装饰。

**核心链路**（验收标准见 §4）：

- **L1 开新任务**：⌘N → 选项目 → 写任务描述（自动生成分支名，可修改）→ 选 agent 与基线分支 → ↵ → 后台创建 worktree、复制被忽略文件、运行 setup → 启动 agent 并送入首条 prompt → 侧栏出现该会话，状态为“运行中”。
- **L2 输入**：直接在终端里打字，按键原样进入 agent 的 TUI，和普通终端一样。
- **L3 被需要时**：agent 请求权限或提出问题 → 会话变为“等你处理”，总览计数、⌘J、系统通知、Dock 角标同时提示 → 进入会话，在 TUI 里作答 → agent 继续运行。
- **L4 审阅与合并**：会话完成（已完成·未读）→ 右侧“变更”查看 diff → 有问题就写行内评论发回 agent；没问题就点“合并” → 预检（是否落后基线、是否有冲突）→ 选合并方式 → 合并到基线 → 选择是否删除 worktree。
- **L5 冲突**：预检发现冲突 → 列出冲突文件 → “交给 agent 解决”（自动生成说明并发送到该会话）或“中止”。
- **L6 Git 全景**：打开“图谱” → 看到 main 与所有 worktree 分支的走向、每个 worktree 的 agent 状态、领先 / 落后 → 点击节点跳到会话 → 右键合并或 rebase。
- **L7 外观定制**：⌘, → 外观 → 选主题 / 英文字体 / 中文字体 / 字号行高 → 预览实时变化。

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
| `needs_you` 等你处理 | 等待权限确认或回答提问 | hook `PermissionRequest`、`Notification(permission_prompt / elicitation_dialog)`、AskUserQuestion 对应的 `PreToolUse`；Codex 标题 `Action Required` |
| `done_unread` 已完成·未读 | 一轮对话结束，用户还没看 | hook `Stop`，且该会话当前不可见 |
| `idle` 空闲 | 已完成且已看过，或刚启动 | 用户看过 `done_unread` 的会话；`SessionStart` |
| `error` 出错 | 本轮失败 | hook `StopFailure`；进程非零退出 |
| `exited` 已退出 | 进程已结束 | PTY exit |

- `needsAttention = needs_you || error || done_unread`，总览计数、⌘J 和 Dock 角标按这个条件筛选。
- 生命周期阶段与状态并列：正在启动 / 未启动 · 点击恢复 / 被首次弹窗挡住（“等你确认：信任此文件夹”）/ 已退出 / 找不到命令。只有 PTY 退出才算终止；`SessionEnd`（如 `/clear`）之后等待下一个 `SessionStart`。
- **自愈**：hook 可能丢事件，所以定期检查进程是否存活。`running` 超过 3 分钟没有收到任何 hook 且标题显示空闲字符（Claude 为 `✳`）时降级为 `idle`；Codex 空闲标题持续 4 s 且没有 hook 时降级（§6.7）。`needs_you` 被用户在 TUI 中直接回答后（随后收到 `PostToolUse` 或 `UserPromptSubmit`），立即恢复为 `running`。
- 状态从不只靠颜色表达：每种状态都有独立的 StatusGlyph 形状和文字。

### 3.2 当前动作
由 `PreToolUse` 的 `tool_name` + `tool_input` 生成，例如 “编辑 auth.ts”、“运行 pnpm test”、“搜索 'useSession'”。没有 hook 时显示为空。

### 3.3 信息架构：两种视图看同一批会话

同一批会话有两种组织方式，各管一件事，互不混用：

| 视图 | 回答的问题 | 组织方式 | 不做的事 |
|---|---|---|---|
| **侧栏** | 它在哪？ | 严格按归属：项目 › 会话。会话永远待在所属项目下面，不会因为状态变化而移动 | 不按状态重排，不把会话提到别的分组 |
| **总览**（F9） | 现在该做什么？ | 跨项目，按状态分组：等你处理 → 出错 → 待审阅 → 运行中 → 空闲 → 已退出 | 不替代侧栏的位置导航 |

**层级规则**：子级在视觉上永远不能比父级更醒目。

| 层级 | 字号 / 字重 / 颜色 | 位置 |
|---|---|---|
| 项目（ProjectHeader） | 13px / 600 / `text-primary`（token `--text-body-heading`），左侧折叠箭头使用 `text-tertiary` | 行内边距左 8px，箭头 16px + 间距 4px |
| 会话标题（SessionRow） | 13px / 400 / `text-primary` | 缩进 28px（`--indent-tree`），状态图形正好落在项目名首字下方 |
| 会话第二行 | 12px / 400 / `text-secondary`（等你处理时用 `status-attention`） | 与标题左对齐 |
| 元信息（时长、`+N −M`、数量） | 等宽 12px / `text-tertiary` | 右对齐 |

- **Worktree 不单独占一层**：大多数 worktree 只有一个会话，所以分支名放在会话第二行（或悬停提示）里。只有同一个 worktree 下有 2 个以上会话时，才在会话之上加一行 worktree 小标题（M4 时再设计）。
- **折叠**：项目可以折叠（点项目名或箭头），折叠状态会持久保存。折叠后，项目标题行显示其下最紧急的状态图形，所以折叠项目里有“等你处理”的会话也不会被漏掉。⌘1–9 跳过折叠项目中的会话；⌘J 不受折叠影响。
- **“等你处理”的入口**：侧栏导航中的“总览”项显示需要处理的数量；⌘J 依次跳到需要处理的会话；Dock 角标和系统通知。不设置顶分组，因为它会让会话离开所属项目、在列表里跳来跳去。

## 4. 功能需求

优先级：**P0** = MVP 必须有 · **P1** = v0.x 公开版本 · **P2** = v1.0 之前。

### ~~F1 输入栏 Composer~~ · 已取消（v1.2）
终端就是全部输入面，按键直接进 PTY，和普通终端一样。终端内键位补充保留：⌘⌫ → Ctrl+U，⌘← / ⌘→ → Ctrl+A / Ctrl+E，⌥← / ⌥→ → ESC b / ESC f。向 TUI 写入文字的实测规则见 §6.9，以后需要程序化发送（如 F4 首条 prompt、F5 评论）时沿用。

### F2 状态侧栏 · P0 · Figma 01 / 02（Sidebar、SessionRow、NavItem）
- 项目 › 会话两级树，层级规则见 §3.3；项目可折叠。跨项目的状态视图交给 F9 总览。
- 每行显示：StatusGlyph、任务标题（默认为首条 prompt，可重命名）、当前动作、`+N −M`、耗时（等你处理时显示“已等 3m”，见 F10）。
- 导航区：打开项目 ⌘O · 跳转到 ⌘K · 总览 ⌘⇧A（右侧显示需要处理的数量，形式为状态图形加数字）。
- 系统通知：只在窗口失焦或该会话不可见时发送，点击后跳到对应会话。Dock 角标显示 `needsAttention` 的数量。
- 快捷键：⌘1–9 切换会话，⌘J 跳到下一个需要处理的会话。
- **验收**：Figma 01 / 02 的侧栏在深色和浅色模式下像素级还原；同时运行 10 个会话时，状态变化在 1 s 内反映到侧栏。

### F3 即时回复 · 改为只做状态（v1.2）
PermissionRequest / AskUserQuestion 只用来把会话标成“等你处理”（侧栏、总览、通知、Dock 角标）。hook 立即返回、不挂起，由 TUI 自己的对话框作答。应用内作答（PromptBar、数字键作答、侧栏内联回复）已取消；当时的按键实测见 §6.6、§6.7、§6.9。

### F4 Worktree 生命周期 · P1 · Figma 06（New task sheet）/ 05（Merge sheet）
- 新建任务 ⌘N：选择项目和基线分支 → 输入任务描述 → 自动生成分支名（`<前缀>/<slug>`，中文标题回退为拼音或时间戳，可手动修改）→ 选择 agent → ↵。
- 后台执行：`git fetch` → `git worktree add --no-track -b <branch> ~/.tr/worktrees/<repo>/<name> <base>` → 记录 `branch.<name>.base` → 按 `.worktreeinclude` 用 `cp -c`（APFS 写时复制）复制被忽略文件 → 在可见终端里运行 setup 脚本 → 启动 agent 并送入首条 prompt。
- **脚本与端口**：可以提交进仓库的 `.tr/settings.toml`，配置 `setup`、`run`、`archive` 三个脚本；会话头放一个 Run 按钮；按工作区分配端口段，注入 `TR_PORT`。
- 本地合并：预检（落后基线的提交数、`git merge-tree --write-tree` 冲突检测、可选测试命令）→ 选择 merge `--no-ff` / squash / rebase + `--ff-only` → 可选“合并后删除 worktree（保留分支）”和“推送到 origin”。
- 冲突处理：列出冲突文件和原因 →「交给 agent 解决」会自动生成说明（冲突类型、分支、文件列表、提醒设置 `GIT_EDITOR=true`）并发送到该会话；或者选择「中止」。能识别仓库处于 merge / rebase / cherry-pick 进行中的状态。
- 清理：合并后提示删除；列出孤儿 worktree（P2：按 TTL 自动回收）。
- **验收**：在测试仓库上完成 L1 / L4 / L5 全流程；合并失败时仓库能回到干净状态。

### F5 Diff 审阅 · P1 · Figma 03（Panel · 变更）/ 13B
- 右侧栏 Git 页签的“变更”视图（F17）：对比基线的文件列表、汇总 `+N −M`，支持 unified / split 视图（`@pierre/diffs`）。
- 行内评论：多条评论可以合并为一条 prompt，一键发给该会话的 agent。
- 底部操作：发送评论 · 放弃 · 合并到 main。
- **验收**：Figma 03 还原；1 万行 diff 滚动流畅。

### F6 Git 图谱 · P1 · Figma 04（Panel · 图谱）
- 自研 lane 算法（`src/shared/git-graph/lanes.ts`，O(n·lanes)，支持增量分页）；每行用 SVG 绘制，`@tanstack/react-virtual` 做虚拟化。
- 在提交行上标出每个 worktree 的 HEAD，以及对应 agent 的 StatusGlyph，点击跳到该会话。
- 筛选：全部分支 / 仅 worktree。
- 右键菜单：切换到会话 · 合并到基线 · 基于基线 rebase · 复制 SHA · 新建 worktree · 删除 worktree。
- 图谱是右侧栏 Git 视图的默认内容（F17，Figma 13B）；原先图谱下方的 Worktree 列表移到 Worktree 视图。
- **验收**：Figma 04 还原；5000 个提交的仓库首屏 < 300 ms。

### F7 外观 · P0（主题 token）/ P1（设置页）· Figma 07 / 08
- 深色和浅色两套主题，token 来自 Figma 变量（Color：bg / text / border / status / diff / term / lane；Layout：space / radius），导出为 CSS 变量。
- **英文字体和中文字体分别设置**：xterm 的 `fontFamily` 为 `"<英文>", "<中文>", monospace`，开启 `rescaleOverlappingGlyphs`；字体加载完成后执行 `clearTextureAtlas()`。
- 字号、行高（默认 1，与普通终端一致）、连字；侧栏毛玻璃（`vibrancy: 'sidebar'`，终端区域保持不透明）。
- **终端底色永远跟随主题**：浅色模式为白色，深色模式为近黑色。不提供渐变 / 图片背景：渐变颜色不随主题变化，会出现文字看不清的组合；而且要求终端透明，会退回到较慢的 DOM 渲染器。旧设置里的渐变 / 图片在读取时丢弃。
- 设置页右侧实时预览；P2 支持导入 Ghostty / iTerm 主题。
- **验收**：Figma 07 / 08 还原；修改设置后，所有终端在 100 ms 内生效，且不需要重启会话。

### F8 全局 · P1
- ⌘K 命令面板（会话、项目、操作）· ⌘, 设置 · ⌘\ 收起或展开侧栏 · ⌘⌥B 收起或展开右侧面板 · ⌘W 关闭会话 · ⌘F 终端内搜索 · ⌘+ / ⌘- / ⌘0 调终端字号（就是设置里的字号）。
- 菜单全部中文：应用 / 文件 / 编辑 / 会话 / 显示 / 窗口。快捷键只定义一处（`src/shared/shortcuts.ts`），菜单、⌘K 和侧栏显示同一套写法。
- ⌘F 的查找条是终端上唯一会叠加的控件：只在用户按 ⌘F 时出现，Esc 关闭并把键盘还给终端。
- **会话常驻**：点关闭按钮只隐藏窗口；⌘Q 退出应用但 agent 继续在后台运行，不弹确认；重新打开时接回同一个进程和屏幕（§6.8）。“退出并结束所有会话”（⌥⌘Q）才真正结束 agent，有运行中的会话时先确认。重启电脑后，会话在第一次打开时用 `--resume` 接上原对话。
- 键盘可以完成所有高频操作；支持减少动态效果；文字和状态的对比度达到 WCAG 2.2 AA。

### F9 状态总览 · P0 · Figma 11 v2（Section `106:3639`）
用户在一个页面里分诊所有 agent，不需要逐个切换会话（Claude Code agent view、Superset Workspaces、Conductor、Vibe Kanban 等产品都采用这一形态）。
- **入口**：主区的一个视图，与终端互斥，不是弹窗。打开方式：侧栏“总览”或 ⌘⇧A；Esc 或 Enter 进入会话后回到终端。
- **列表（默认）**：跨项目按状态分组，顺序为 等你处理 → 出错 → 待审阅（`done_unread`）→ 运行中 → 空闲 → 已退出。已退出组默认折叠；分组的折叠状态会保存。分组标题只用文字、数量和细分隔线表达，不用色块。分组标题行和会话行都高 40，行内所有文字行高 20、严格垂直居中；分组之间用 12 的间距隔开。
- **每行**：StatusGlyph + 状态文字 · 标题 · `项目 › 分支` · 摘要（运行中显示当前动作；等你处理显示问题或待确认的命令；出错显示错误摘要；其他状态显示最后一句回复）· `+N −M` · 时间（等你处理显示“已等 3m”，运行中显示本轮用时，其余显示“5m 前”）· 悬停显示 ⌄。后续接入：todo `3/7`（F12）、`ctx 62%`（F11）、PR `#123 ✓`（F16），数据未就绪时这几列留空，不占位。
- **列表 · 原地展开（点行 / Space）**：在该行下方展开这个会话**完整、可交互的终端**——就是主区里同一个 xterm、同一个 PTY，搬到总览里显示，不新建进程，也不是快照。同一时间只展开一行，上方的行不动，下方的行顺延。托盘 `bg/hover` 底、圆角 5、内边距 4；终端默认高 420，拖托盘底边可调到 240 – 窗口高度 70%（会保存）。展开行隐藏 `+N −M` 和时间，换成“进入会话 ↵”和 ⌃。会话状态变化时托盘跟着它移到新分组，不会收起。收起：再点一次行、点 ⌃，或 Esc。
- **看板**：同一套分组画成列，列内是无描边的状态色块卡片（`card/<状态>` 底色，次要文字用同色相的 `card/<状态>-meta`，悬停换 `-hover`）；状态同时由 StatusGlyph 形状和列标题表达，不只靠颜色。列表和看板的分组永远一致。
- **看板 · 会话浮层（点卡片 / Space）**：居中模态浮层，宽 `min(窗口 − 240, 1200)`、高 `min(窗口 − 120, 780)`，圆角 10，1px `border/default` + Overlay 阴影；遮罩 `overlay/scrim` 盖住整个窗口（含侧栏）。48 高的标题栏：状态图形 · 会话名（13/600）· `项目 › 分支` ｜ 状态文字与时长 · 进入会话 ↵ · 关闭 ×；下面全部是该会话完整、可交互的终端。关闭：Esc、点遮罩、点 ×。
- **键盘**：↑↓ 移动（不带动已展开的终端），Enter 进入会话，Space 展开 / 收起（看板为打开浮层），Esc 先收起展开的终端或浮层、再离开总览。焦点在终端里时，所有按键（包括 Esc）都交给终端——agent 用 Esc 中断或拒绝；点终端外（行、标题栏）后 Esc 恢复上述含义。顶部过滤框支持文本、`p:项目`、`s:状态`。
- **批量操作**（P1）：⇧ 或 ⌘ 多选后可以停止、关闭，或发送同一条消息（广播只放在这里）。
- **验收**：Figma 11 v2（A 列表收起 / B 原地展开 / C 看板色块 / D 看板浮层）在深浅两套主题下还原；20 个会话时打开总览 < 100 ms；状态变化 1 s 内反映到行和分组；纯键盘可以完成“找到等你处理的会话 → 展开 → 进入会话”；在展开的终端里输入直接到达该会话的 PTY。

### F10 等待时长与有内容的通知 · P0
- 时间列的含义随状态切换：运行中显示本轮用时；等你处理显示“已等 3m”，超过 5 分钟后字重加粗，颜色不变；空闲 / 已完成显示“5m 前”。
- 通知：标题写“项目 · 会话”，正文写问题、待确认的命令或最后一句回复；多个会话同时完成时合并成一条。

### F11 上下文占用与额度 · P1
- 在按次注入的 `--settings` 里加一条 statusLine 命令，把 Claude Code statusLine JSON 中的 `context_window.used_percentage` 和 `rate_limits.five_hour / seven_day` 转发给 HookServer。如果用户已经配置了自己的 statusLine，必须串联调用它并原样输出它的结果，不能覆盖。
- 会话头显示 `ctx 62%`，超过 80% 时提示可以 `/compact`。额度显示在总览顶栏右侧，悬停可看重置时间。Codex 的接法待预研。

### F12 todo 进度 · P1
- 解析 PreToolUse 中 TodoWrite / Task* 的 `tool_input`，得出 `完成数 / 总数` 和当前项。侧栏行以文字或 1px 细进度线显示，总览显示 `3/7 · 当前项`。具体工具名需要先在当前版本的 Claude 上实测。

### F13 一键 AI 审阅 · P1
- 变更面板和总览“待审阅”行提供“让 agent 审阅”：向该会话发送 `/code-review`（Claude）或 `/review`（Codex）。审阅结果留在 TUI 里，暂不解析回 diff。

### F14 端口检测 · P1
- 主进程低频扫描每个 PTY 子进程树正在监听的端口（`lsof`，按需开启），在会话行和总览中以小标签显示 `:5173`。点击在右侧栏的浏览器页签中打开（F17），⌥ 点击用系统浏览器打开，右键可以结束进程。

### F15 归档 · P1
- 归档 = 停止 agent + 把 worktree 状态（含未提交的改动）存进私有 ref + 从侧栏隐藏。可以在 ⌘K“历史”中恢复，恢复时用 `--resume` 接上原对话。合并后可选自动归档。agent 运行中不允许归档。

### F16 PR / CI 只读状态 · P1
- 检测到 `gh` 且已登录时，会话行和总览显示 `#123` 与 checks 状态（✓ / ✗ / 进行中）。CI 失败时提供“让 agent 修复”，由我们生成一条 prompt 发给该会话。创建和合并 PR 是后续工作。

### F17 右侧栏 · P1 · Figma 13（Section `134:5521`）
右侧栏是终端旁边、浮在窗口上的一层辅助视图（形态参考 Claude Code 桌面版的终端面板），不承载对 agent 的输入（终端仍是全部输入面）。内容永远跟随**当前会话所在的 worktree**；切换会话时各页签一起切换。
- **外壳**：一张浮起的卡片，上 / 右 / 下内缩 8，宽 480（拖左边缘调宽，最小 400，宽度会保存），圆角 10，`bg/float` 底 + 1px `border/subtle` 描边 + `Elevation/Pane` 阴影。卡片内部**不用分割线**，层次只靠间距、字号和 `bg/hover` / `bg/inset` 底色；每个视图最多一个实心主按钮，其余用无边框的 Ghost 按钮或图标。
- **切换**：没有页签栏。会话头右侧四个图标（地球 = 浏览器 · git-branch = Git · git-fork = Worktree · 文件夹 = 文件），当前视图的图标为 Active 底色；再点一次收起。⌘⌥B 开关（记住上次的视图）。卡片顶部 40 高：标题 · 上下文（等宽三级色）· 少量图标 · ×。主区放不下时沿用浮层规则（B13）。会话头里重复的 agent 状态文字去掉（侧栏已显示）。
- **浏览器**（13A / 13E）：卡片顶部就是工具栏 = 后退 · 前进 · 刷新 · 无边框地址框（host 用主色、路径用三级色）· 用系统浏览器打开 · ×。下面一行列出本会话监听的端口（无边框的 PortTag，选中的带 `bg/selected` 底，点一下打开），右侧手机图标切换 375 视口（移动端模拟）。网页放在内缩 8 的 `bg/inset` 圆角区域里。底部：错误、警告数（StatusGlyph + 文字）和 Ghost 按钮“发给 Claude”——按 §6.9 的发送规则把错误文本发给当前会话。还没有端口时显示空状态（13E），不自动打开任何页面。
  - 技术：主进程里的 `WebContentsView`，独立 session 分区 `persist:tr-browser`，无 preload，`contextIsolation` + `sandbox` 开启，页面拿不到 `window.tr`；只允许 `http(s)`；控制台来自 `console-message` 事件；移动端视口用 `enableDeviceEmulation`。
- **Git · 图谱**（13B / 13H，默认视图）：标题行“Git · 项目名”+ 拉取（fetch）· 更多 · ×；下面是无边框分段“图谱 / 变更 N”和“全部分支 ⌄”筛选。提交图（F6）：每行 28 高；lane 间距 17，线宽 2，分叉 / 合并用半径 8 的圆角转弯；颜色取 `lane/main`、`lane/1…5`（main 用中性灰）；提交点 8，当前 HEAD 点 10，点外圈 2px `bg/float` 让线条断开。行内：✓（当前 worktree 的 HEAD）· ref 胶囊（`GraphRef`：本地分支实线 + 分支图标，远程分支虚线 + 地球图标，worktree 实线 + 该 worktree 里会话的 StatusGlyph，tag 中性色；描边和图标取所在 lane 的颜色）· 提交说明（当前 HEAD 主色，其余二级色）· 时间。当前 HEAD 行有 `bg/selected` 底。点 worktree 胶囊切到那个会话；右键菜单同 F6。
- **Git · 变更**（13B2）：分支行下面按 **未提交**（agent 还没提交的工作区改动）和 **已提交**（对比基线）分组，文件行和 diff 沿用 F5；底部只有 Ghost“创建 PR”和主按钮“合并到 main ⌘M”（“发回 Claude 修改”由行内评论的“发给 Claude”承担）。
- **Worktree**（13C）：当前项目的全部 worktree（`git worktree list --porcelain`），每行：StatusGlyph（其中最紧急的会话）· 名称 · 未提交 `+N −M` · 领先 / 落后，第二行是会话名和 agent，第三行是路径。点一行切到那个会话；选中行展开详情（分支、基线、未提交文件、端口段）和操作（Ghost）：打开文件夹 · 合并到 main…（F4）· 更多（在此新建会话、删除等）。“可清理”分组收纳已合并或没有会话的 worktree，可以一键清理（F4）。标题行的 + 即“新建 ⌘N”（F4）。
- **文件**（13D / 13F）：当前 worktree 的目录树，目录按需加载；git 状态用字母（M / A / D / U）加颜色，含改动的目录显示 “•”，被 `.gitignore` 忽略的项变暗但仍可展开。标题行：文件 · 根目录名 · 在 Finder 中打开 · 更多；下面是无边框的 `bg/inset` 筛选框，框内右侧是“有改动 N”开关。
  - 打开：双击 = 应用内只读预览（13F，行号 + 改动标记，Esc / ← 返回）；⌘↵ = 用系统默认编辑器打开（`shell.openPath`）。右键：预览 · 用默认编辑器打开 · 在 Finder 中显示 · 插入路径到终端（把 `@相对路径 ` 写进当前会话的输入行，规则同 §6.9）· 复制相对路径。
  - 主进程校验所有路径都在该 worktree 根目录之内；文件变化用 `fs.watch` 增量刷新。
- **验收**：Figma 13 在深浅两套主题下还原；切换会话时右侧栏 100 ms 内换成新 worktree 的内容；1 万个文件的仓库首屏目录树 < 200 ms；浏览器页面无法访问 `window.tr` 和 Node。

### P2 储备（已验证，但排在后面）
代码 checkpoint（`refs/tr/checkpoints/…`，对话部分交给 Claude 原生的 `/rewind`）· 历史会话搜索（其中“恢复旧对话”选择器为 P1，放进 ⌘K）· best-of-N 竞赛（依赖 F4，在总览中比较）· Claude Remote Control 菜单入口（发送 `/remote-control`，需要实测）· 仓库级预设 prompt（`.tr/settings.toml`）· 实时终端网格（最多 4 格）· `@` 文件引用 · GitHub PR 创建 / 合并。

## 5. 设计规范

- 唯一的设计来源是 Figma 文件中的 Foundations、Components、Screens 三页。屏幕节点：01 运行中 `14:2` · 02 等你处理 `16:178` · 03 变更审阅 `16:405` · 04 Git 图谱 `18:591` · 05 合并预检 `19:814` · 06 新任务 `19:940` · 07 设置·外观 `21:1223` · 08 浅色模式 `24:1790` · 09 侧栏入口 `51:1460` · 10 会话生命周期 `64:2225` · 11 v2 总览（Section `106:3639`；深色 A 列表收起 `106:3640` · B 列表原地展开 `106:4038` · C 看板色块 `108:4091` · D 看板浮层 `108:4366`；浅色 `108:5704` / `108:5757` / `108:5814` / `108:5866`；状态色块卡片与交互说明 `110:5348`；组件 OverviewGroupHeader v2 `104:145` · OverviewRow v2 `104:191` · StatusCard `104:286` · SessionOverlayBar `104:287`）。旧版 11 / 11b / 11c（`71:2635` / `72:2918` / `72:2617`）已被 v2 取代。13 右侧栏 v2 浮层（Section `134:5521`；A 浏览器 `147:6926` · B Git 图谱 `154:6902` · B2 Git 变更 `147:7126` · H Git 图谱浅色 `155:8584` · C Worktree `149:5973` · D 文件 `149:6307`；E 浏览器空状态 `151:7248` · F 文件预览 `151:7333` · G 文件浅色 `151:7550`；组件 FileTreeRow `130:259` · WorktreeRow `130:282` · BrowserBar `130:283` · GraphRef `153:210`，新图标在 Components 页 Section `130:152`；新增 token `bg/float`（深色 gray/900、浅色 gray/0）和效果样式 `Elevation/Pane`）。
- 侧栏层级以 Components 页的 `ProjectHeader`（Default / Hover / Collapsed）和 `SessionRow` 为准，规则见 §3.3。总览组件在 Components 页的 Overview 分区：`OverviewGroupHeader` `70:222` · `OverviewRow` `70:324` · `BoardRow` `70:608`；`NavItem` 新增 `Show count` / `Count` 属性。
- 字体：UI 使用系统字体 SF Pro（Figma 中的 Instrument Sans 只是替身）；等宽字体默认 JetBrains Mono；中文默认思源黑体 SC / 苹方，并逐段显式指定。
- 风格约束：零彩度中性色；颜色只用于表达状态；用排版、对齐和细分隔线建立层级；小圆角（3 / 5 / 窗口 10）；不使用卡片堆叠、渐变或装饰性小字。
- 每个组件实现时，用 Figma MCP 的 `get_design_context` 读取对应节点，并配合 Code Connect 映射。

## 6. 技术架构

### 6.1 进程模型
```
Main（Electron 主进程）
 ├─ 工作区、设置、窗口状态：原子写入的 JSON（~/Library/Application Support/TerminalReborn）
 ├─ HookBridge：规范化 hook 事件 → 状态机 → 通过 IPC 推送给 renderer
 ├─ GitService：调用 git CLI 子进程（不用 libgit2）
 └─ WorktreeService / Notifications / Dock badge
tr-ptyd（PTY 守护进程，独立于应用存活，§6.8）：node-pty 会话池 · 每会话一个 HeadlessMirror · hook socket
PtyHost（utilityProcess）：守护进程不可用时的后备，会话随应用结束
Renderer（React 19 + zustand）：侧栏 · 总览 · TerminalSurface(xterm.js) · 右侧面板 · 设置
```

### 6.2 Hooks 注入（不修改用户的全局配置）
- 应用自己拼 agent 的启动参数，不用 wrapper：Claude 用一个 `--settings <生成的 json>`（只能有一个，§6.6）；Codex 用 `-c hooks.<Event>=…` 加 `-c hooks.state=…` 固定信任（§6.7）。从不写 `~/.claude/settings.json` 或 `~/.codex/*`。
- hook 命令是 `/bin/sh '<tr-hook.sh>' <Event> <agent>`：读取 stdin 的 JSON，用 `curl --unix-socket` 带上 `TR_SESSION_ID` 和 `X-TR-Token` 发给 hook socket；应用不可达时 exit 0、不输出。PTY 环境里的 `TR_SESSION_ID / TR_HOOK_SOCK / TR_HOOK_TOKEN` 由 main 设置，覆盖 renderer 传来的同名变量。
- 服务端拒绝没有 token 的请求（403）和不是自己启动的 PTY 的请求（404）。只转发规范化后的事件，从不转发原始 payload。
- Codex 启动时用 `-c check_for_update_on_startup=false` 和按次的 `projects` 信任跳过启动弹窗。Claude 的目录信任框不预写，检测到时把会话标为“等你确认：信任此文件夹”。
- 待做：用户自己在 alias 里追加的 `--settings` 需要和我们的深合并成一个。

### 6.3 终端
- 定义 `TerminalSurface` 接口（write / onData / buffer 读取 / OSC 订阅 / resize），xterm.js 是它的第一个实现，以后可以替换为 libghostty。
- xterm 配置：使用 WebGL 渲染，失败时**按终端**回退到 DOM 渲染；开启 unicode11；纹理图集定期重置；kitty 键盘协议保持关闭；切换标签或面板后强制执行 fit + resize。
- 行高默认 1；终端底色取主题色（F7）。

### 6.4 目录结构
```
src/main/        app、窗口、IPC、hooks/、pty/（守护进程客户端）、工作区与设置存储、通知、更新检查
src/pty-daemon/  守护进程入口、wire 协议、hook socket、空闲退出、磁盘快照
src/pty-host/    session-host、HeadlessMirror、流控；utilityProcess 后备入口
src/preload/     window.tr（TrApi）
src/renderer/    app-shell、sidebar、overview、terminal、session-header、command-palette、settings、status、lifecycle、panels、state、ui、styles/tokens.css
src/shared/      types、ipc、session-state-machine、current-action、send-protocol、agent-launch、settings、lifecycle
resources/hooks/ tr-hook.sh
scripts/spikes/  实测脚本（不打包），复测 §6.6–§6.9 的结论
```
`src/shared` 中都是纯逻辑，全部用 Vitest 覆盖。

### 6.5 可借鉴代码（仅限 MIT / Apache 许可）
Orca：IME 处理、AskUserQuestion 按键序列、worktree porcelain 解析、`.worktreeinclude`、PTY 守护进程。Nimbalyst：`claudeCliSubmit.ts` 发送规则。Vibe Kanban / Crystal：合并预检和冲突 prompt。借用代码时在文件头注明出处和许可证，并登记在 `THIRD_PARTY_NOTICES.md`。cmux / Warp / Superset / vscode-git-graph 只参考思路，不复制代码。

### 6.6 实测结论 · Claude Code hooks（2.1.299，2026-10-14）
脚本 `scripts/spikes/30-hooks-lab.mjs`；真实 payload 在 `src/main/hooks/fixtures.ts`。
- **`--settings` 是合并，不是替换**：用户自己的 hooks、插件 hooks 和我们的 hooks 对同一事件都会运行；用户的 permissions / model 不受影响。**传两个 `--settings` 时只认最后一个**，第一个整个被丢掉，所以命令行上只能有一个。
- hook 命令是 shell 字符串；脚本丢了执行位会以 126 失败，所以用 `/bin/sh '<script>'` 调用。路径里的空格（`Application Support`）要加引号。
- **目录信任之前 hooks 不运行**（连 SessionStart 都没有），所以“还没收到 hook”按未知处理，不算出错。
- 与 Orca 等工具的全局 hooks 并行运行、互不影响：它们没有 `TR_*` 环境变量，我们的 hook 在它们的终端里不起作用，反之亦然；Orca 对 PermissionRequest 返回的 `{}` 不会盖掉我们的决定。
- **“等你处理”以 PermissionRequest 为准**：`Notification(permission_prompt)` 要晚约 6 s；`idle_prompt` 在 Stop 后约 60 s。
- **AskUserQuestion 也会触发一个不带 suggestions 的 PermissionRequest**，它不是允许 / 拒绝问题，要立即空回复；问题内容取自 PreToolUse 的 `tool_input`。
- PermissionRequest 没有 `tool_use_id`，靠“工具名 + 输入”和后面的 PostToolUse 配对。
- 挂起 PermissionRequest 时，TUI 自己的确认框照常显示；用户在 TUI 里作答后，Claude **不会**结束 hook 进程，要由我们回空结果释放。空结果 = 没有意见，TUI 照常。v1.2 起一律立即空回复（`holdPermissions: false`）。
- 当时“总是允许”的实测：原样返回 suggestions 里的 `setMode` 会切换整个会话的模式；`destination: userSettings` 会写 `~/.claude/settings.json`。以后如果再做应用内允许，这两类必须过滤掉。
- 用户默认的 auto 模式下，无害的 Bash 不会触发 PermissionRequest。
- PostToolUse 带完整的工具输出（可能几 MB），服务端上限 32 MB。
- 延迟：每个 hook 15–25 ms（SessionStart 冷启动约 75 ms）；UserPromptSubmit 在回车写入约 75 ms 后到达。`SessionEnd` 的 hooks 一共只有 1.5 s。

### 6.7 实测结论 · Codex（0.142.5，2026-10-14）
脚本 `scripts/spikes/40-codex-hooks-list.mjs`、`41-codex-hooks-lab.mjs`、`codex-mock-provider.mjs`（本地模拟模型）；payload 在 `src/main/hooks/codex-fixtures.ts`。当时第三方模型服务一直返回 503，所以依赖真实模型的行为没有验证。
- hooks 默认开启，0.142.5 认 10 个事件。**没有 SessionEnd 和 Interrupt**（未知事件名会被静默丢掉）；也没有 PostToolUseFailure、Notification、StopFailure。**SessionStart 在第一条 prompt 时才发**。失败的请求和被中断的回合**不发 Stop**。
- **注入**：`-c hooks.<Event>=[{hooks=[{type="command",command="…",timeout=N}]}]` 形成独立的 `sessionFlags` 层，和用户的 hooks 叠加。换 `CODEX_HOME` 会丢掉登录状态，只在 e2e 里用。
- **信任**：会话级 hook 默认 untrusted，会被跳过。不用 `--dangerously-bypass-hook-trust`，因为它会放行仓库和插件里所有没审过的 hook。做法：每次运行应用时启动一次 `codex app-server`，用 `hooks/list` 读出我们这些 hook 的 `currentHash`（0.3–0.5 s，失败不缓存），再用 `-c hooks.state={"<key>"={trusted_hash="sha256:…"}}` 只信任这几条。hash 由 Codex 自己算，我们不重新实现。探测失败或没覆盖全部 6 个事件时，就不带 hooks 启动，只靠标题判断状态。
- **PermissionRequest 挂起时 Codex 不显示自己的确认框**（与 Claude 相反）。allow 会运行工具；deny 让工具失败，但回合继续；空回复后 Codex 才显示原生确认框。`updatedInput` / `updatedPermissions` / `interrupt` 对 Codex 会“fail closed”，所以决定里只写 `behavior`。
- 原生确认框：`y` / `1` 允许；`Esc` / `3` 取消并中断整个回合；`p` / `a`（不再询问）会写 `~/.codex/rules`，应用永远不发。
- `request_user_input` 只在 Plan 模式出现，不触发 PermissionRequest；按数字选中即提交，最后一题提交整个调用，没有确认页。
- **标题**：空闲时是目录名；工作中（包括 PermissionRequest 挂起时）是盲文 spinner + 目录名；原生确认框出现时 `[ ! ] Action Required | <dir>` 和 `[ . ] …` 交替。状态规则：Action Required → `needs_you`；空闲标题持续 4 s 且没有 hook → `idle`（覆盖中断、503 这些没有 Stop 的情况）。不发 OSC 9 / 777 / 133 / 7501。
- 空 prompt 下按一次 Ctrl+C 就开始退出；运行中 Ctrl+C 和 Esc 都只是中断回合。
- 工具映射到 Claude 的词汇：shell → `Bash {command}`；`apply_patch` → `Write` / `Edit`；`request_user_input` → `AskUserQuestion`。PostToolUse 的 `tool_response` 是纯字符串，没有退出码。
- 延迟：UserPromptSubmit 在回车约 100 ms 后到达，PermissionRequest 比 PreToolUse 晚约 21 ms。

### 6.8 PTY 守护进程（2026-10-16 实现）
参考 Orca（MIT）的 `src/main/daemon/*`，只取核心形态，不要 launchd。e2e：`e2e/pty-daemon.spec.ts`；其余 e2e 用 `TR_KILL_SESSIONS_ON_QUIT=1` 退出，不留守护进程。
- **进程**：应用自己的二进制以 `ELECTRON_RUN_AS_NODE=1` 运行 `out/main/pty-daemon.js`，detached、独立会话，cwd 为 userData（不能是可能被删的 worktree）。依赖 Electron 的 `runAsNode` fuse 保持开启。应用退出、main 崩溃、开发时 ⌘R 都不影响它。
- **端点**：`<userData>/daemon/` 下有 `daemon-v<PROTOCOL>.sock`（路径超过 103 字节时改用 `/tmp/tr-<uid>-ptyd-<hash>/`）、`token`（32 字节）、`daemon.json`（pid、协议、版本）、`daemon.log`（5 MB 轮转）。目录 0700、文件 0600，拒绝符号链接。每个连接的第一帧是 `hello {token, protocol}`，用 `timingSafeEqual` 比较。
- **启动**：能连上就接管；`ENOENT` / `ECONNREFUSED` 就删掉旧 socket、拉起新的，3 s 内轮询连接；其他错误（超时、`EPERM`）不当作“已死”，本次退回 utilityProcess（`TR_PTY_DAEMON=0` 可强制）。运行中连接断开，按终端进程崩溃处理（恢复卡片 + `--resume`）。
- **协议**：NDJSON；在原有 HostRequest / HostEvent 之外加 `hello` / `list` / `attach` / `detach` / `shutdown`，`data` 事件带 `seq`。spawn 使用**应用**当前的环境变量，避免几天前启动的守护进程给新 shell 一个过期的 PATH。`hello` / `list` / `shutdown` 跨版本冻结：协议版本不同时，旧守护进程的会话存盘、结束，再用 `--resume` 冷恢复。
- **HeadlessMirror**：每个会话一个 `@xterm/headless`（scrollback ≤ 5000、unicode11）。快照 = 序列化的屏幕（含备用屏）+ 重放模式序列（备用屏、bracketed paste、应用光标、隐藏光标、焦点上报、鼠标跟踪和 SGR 编码）+ 最后的标题。用一次空写入的回调取得和 `seq` 一致的切点。没有客户端时不暂停 PTY，agent 不会因为应用关着而卡住。
- **重连**：每次页面加载只调用一次 `pty.live()`（第二次会把本页会话悄悄 detach），然后 attach 所有活着的会话（状态、通知需要它们的输出）。渲染端清屏 → 按快照尺寸 → 写快照、模式、标题 → 丢掉 `seq` 不超过快照的数据块 → 进入实时。没命中就走冷路径：先画磁盘快照，再 `--resume`。窗口卸载和渲染进程崩溃只 detach，不 kill。
- **退出**：⌘Q 不确认，会话继续；⌥⌘Q 结束所有会话。没有活会话、也没有客户端 10 s 后守护进程退出；拉起后 2 分钟没被接管也退出。已退出的会话保留退出码和最后一屏。
- **hooks**：守护进程持有 hook socket（`<userData>/daemon/hooks/`），收到的事件转给 main 的 HookBridge。应用没连着时立即空回复，并记入该会话最近 64 条日志（超过 64 KB 的 payload 置空）；重连时按原时间戳补放，所以关着应用时结束的回合，打开后显示正确的状态。
- **磁盘快照**：没有客户端时，会话安静 30 s 后由守护进程写 `terminal-snapshots/<id>.json`（与渲染端同格式、同 2 MB 上限），这样重启电脑后冷路径也能看到最新一屏。同一时间只有一个写者。
- **实测**（打包版 arm64，Claude 2.1.302）：守护进程启动约 145 ms；⌘Q 后应用 0.2–0.3 s 退出，shell、claude、守护进程都还在；重开后是同一组 pid，第一帧 68–140 ms（目标 < 150 ms）；真实 agent 下守护进程 CPU < 1%。纯吞吐（`seq 1 3000000`）时瓶颈在 PTY 读取，和 utilityProcess 相当。

### 6.9 实测结论 · 向 TUI 写入文字和按键（Claude 2.1.296–2.1.299 / Codex 0.142.5）
规划在 `src/shared/send-protocol.ts`；脚本 `scripts/spikes/harness.mjs`、`22-ask-user-question.mjs`。
- 每个 PTY 一个串行发送队列。正文用 `ESC[200~ … ESC[201~` 包起来写入，先清除会提前结束粘贴的控制字符；在 xterm buffer 里看到正文开头或占位符后才进入下一步，超时按 UTF-8 字节数计算。
- 回车 `\r` 单独写一次（Claude 等 60 ms，Codex 等 150 ms）。
- 占位符阈值：Claude 超过 800 字符或含 3 个以上换行；Codex 超过 1000 字符。
- `/` 命令首字符单独按键；Claude 里长到会变成占位符的 `/cmd` 必须逐字输入，否则不再被识别为命令；Codex 不带参数的 slash 命令末尾补空格，防止误执行模糊匹配项。`#` 不用特殊处理。
- agent 正忙时发送 = **排队**（Claude 依次处理；Codex 会把多条合并），不是打断。
- Claude 的 AskUserQuestion 菜单：选项编号后面固定跟 `Type something`（N+1）和 `Chat about this`（N+2）。单选按 `N` 直接提交；自由文本按 `N+1`、输入、`Enter`；多个问题时每题答完自动进下一题，最后在“Review your answers”再按一次 `Enter`；多选按 `N` 切换，`→` 离开；多选加自由文本要用 `↓` 移到对应行输入。超过 9 个选项时用方向键加 `Enter`。

## 7. 开源与工程规范

- 许可证：**MIT**（与主要借鉴来源兼容）。仓库公开，包含 README（中英文）、CONTRIBUTING，以及第三方许可证清单 `THIRD_PARTY_NOTICES.md`。
- CI（GitHub Actions）：typecheck · ESLint · Vitest · Playwright（`_electron`）冒烟测试 · electron-builder 打包。
- 发布：推 `v*` tag 后流水线构建 arm64 和 x64 的 dmg + zip，生成 GitHub Release 草稿；应用每 24 h 检查一次新版本并提示。目前是 ad-hoc 签名，Developer ID 签名、公证和自动更新需要作者的 Apple Developer 账号。发版步骤见 [CONTRIBUTING](../CONTRIBUTING.md)。
- 隐私：默认不收集任何遥测数据；崩溃上报为可选项，需用户主动开启。
- 版本：遵循 SemVer，维护 CHANGELOG。
