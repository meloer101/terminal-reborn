# TerminalReborn PRD 与开发路线图

> 版本 v1.2 · 2026-10-16（v1.1 同日 · v1.0 2026-10-13）· 状态：待评审
> v1.2 变更（作者决定）：**终端就是全部界面**——取消 F1 输入栏和 F3 应用内作答（PromptBar），终端里不叠加任何控件；权限请求只用于标记“等你处理”，在 TUI 里作答；总览预览只读；终端默认行高 1（与普通终端一致）；终端底色只跟随浅色 / 深色主题，取消渐变 / 图片背景。
> v1.1 变更：新增 §3.3 信息架构（侧栏层级规则，取消“等你处理”置顶队列）；F2 改写；新增 F9 状态总览（P0）与 F10–F16（来自 10-16 功能调研）；路线图插入 2b · 总览，M4 扩充脚本 / 端口 / 归档，PR·CI 只读状态从 M6 提前。
> 关联：[产品简报](product/product-brief.md) · [竞品调研](research/2026-10-13-competitive-research.md) · [功能调研 10-16](research/2026-10-16-feature-research.md) · [UX 走查 10-15](acceptance/ux-review-2026-10-15.md) · [Figma 设计稿](https://www.figma.com/design/x6HGsLiMTk7fWDoKI5YkKh/coding-terminal)

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
在保留 agent 原生 TUI 的前提下，补齐四件事（v1.2 起不再做应用内输入栏）：**agent 状态与跨项目总览**、**本地 worktree 全链路**、**带 agent 状态的 git 图谱**、**可深度定制且对中文友好的外观**。

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

### 3.3 信息架构：两种视图看同一批会话

同一批会话有两种组织方式，各管一件事，互不混用：

| 视图 | 回答的问题 | 组织方式 | 不做的事 |
|---|---|---|---|
| **侧栏** | 它在哪？ | 严格按归属：项目 › 会话。会话永远待在所属项目下面，不会因为状态变化而移动 | 不按状态重排，不把会话提到别的分组 |
| **总览**（F9） | 现在该做什么？ | 跨项目，按状态分组：等你处理 → 出错 → 待审阅 → 运行中 → 空闲 → 已退出 | 不替代侧栏的位置导航 |

**层级规则**：子级在视觉上永远不能比父级更醒目。（v1.0 的侧栏违反了这条：项目名用 12px 次要色，会话标题却是 13px 中粗主色。）

| 层级 | 字号 / 字重 / 颜色 | 位置 |
|---|---|---|
| 项目（ProjectHeader） | 13px / 600 / `text-primary`（token `--text-body-heading`），左侧折叠箭头使用 `text-tertiary` | 行内边距左 8px，箭头 16px + 间距 4px |
| 会话标题（SessionRow） | 13px / 400 / `text-primary` | 缩进 28px（`--indent-tree`），状态图形正好落在项目名首字下方 |
| 会话第二行 | 12px / 400 / `text-secondary`（等你处理时用 `status-attention`） | 与标题左对齐 |
| 元信息（时长、`+N −M`、数量） | 等宽 12px / `text-tertiary` | 右对齐 |

- **Worktree 不单独占一层**：大多数 worktree 只有一个会话，所以分支名放在会话第二行（或悬停提示）里。只有同一个 worktree 下有 2 个以上会话时，才在会话之上加一行 worktree 小标题（M4 时再设计）。
- **折叠**：项目可以折叠（点项目名或箭头），折叠状态会持久保存。折叠后，项目标题行显示其下最紧急的状态图形，所以折叠项目里有“等你处理”的会话也不会被漏掉。⌘1–9 跳过折叠项目中的会话；⌘J 不受折叠影响。
- **“等你处理”的入口**改为三处：侧栏导航中的“总览”项显示需要处理的数量；⌘J 依次跳到需要处理的会话；Dock 角标和系统通知。原来置顶的“等你处理”分组已取消，因为它会让会话离开所属项目、在列表里跳来跳去（UX 走查 #7）。

## 4. 功能需求

优先级：**P0** = MVP 必须有 · **P1** = v0.x 公开版本 · **P2** = v1.0 之前。

### F1 输入栏 Composer · ~~P0~~ 已取消（v1.2）· Figma 01（Composer、Selection）
> 2026-10-16 取消：终端就是全部输入面，按键直接进 PTY，和普通终端一样。以下内容仅作历史记录；`src/shared/send-protocol.ts` 的实测结论仍可供以后参考。
- 原生多行编辑：支持选中、⌘A、⌘⌫、⌥⌫、撤销/重做、在任意位置插入。↵ 发送，⇧↵ 换行。
- 输入法安全：`isComposing` 为真、`keyCode === 229` 或 `key === 'Process'` 时，回车不触发发送。
- 草稿按会话保存，切换会话和重启应用后都能恢复。Esc 不清空草稿。
- **直通**：输入栏为空时，Esc、↑、↓、⇧Tab、Ctrl+C 直接转发给 agent。
- 拖入图片或文件：存为临时文件，以 bracketed paste 写入**路径**。
- `@` 引用文件：在 worktree 内做模糊搜索（P1）。
- **发送协议**（`src/shared/send-protocol.ts` 规划 + `send-executor.ts` 执行；实测依据见 [docs/spikes/send-protocol.md](spikes/send-protocol.md)，Claude Code 2.1.296 / Codex 0.142.5）：
  1. 每个 PTY 一个串行发送队列；
  2. 正文用 `ESC[200~ … ESC[201~` 包起来写入，先清除会提前结束粘贴的控制字符；
  3. 闭环确认：在 xterm buffer 中看到正文开头或占位符后，才进入下一步；超时按 **UTF-8 字节数**计算；
  4. 回车 `\r` 单独写一次（Claude 等 60 ms，Codex 等 150 ms）。新版本里不分开也能提交，保留作为保险；
  5. 占位符阈值按 agent 区分：Claude 超过 800 字符或含 3 个以上换行；Codex 超过 1000 字符；
  6. `/` 命令：首字符单独按键；Claude 里长到会变成占位符的 `/cmd` 必须逐字输入，否则不再被识别为命令；不带参数的 slash 命令在 Codex 末尾补空格可防止误执行模糊匹配项（Claude 补空格无效）。`#` 不再特殊处理；
  7. agent 正忙时发送 = **排队**（Claude 依次处理；Codex 会把多条合并），不是打断；
  8. 启动弹窗：Codex 用 `-c check_for_update_on_startup=false` 与按次的 `projects` 信任参数跳过；Claude 的目录信任框需要预写 `~/.claude.json` 中该项目的信任标记，或检测到弹窗时禁用输入栏。
- 终端内键位补充：⌘⌫ → Ctrl+U，⌘← / ⌘→ → Ctrl+A / Ctrl+E，⌥← / ⌥→ → ESC b / ESC f。
- **验收**：§1.3 的测试矩阵在 Claude 和 Codex 上全部通过；搜狗和系统拼音输入法下，选字时回车不会误发。

### F2 状态侧栏 · P0 · Figma 01 / 02（Sidebar、SessionRow、NavItem）
- 项目 › 会话两级树，层级规则见 §3.3；项目可折叠。不设置顶队列，跨项目的状态视图交给 F9 总览。
- 每行显示：StatusGlyph、任务标题（默认为首条 prompt，可重命名）、当前动作、`+N −M`、耗时（等你处理时显示“已等 3m”，见 F10）。
- 导航区：打开项目 ⌘O · 跳转到 ⌘K · 总览 ⌘⇧A（右侧显示需要处理的数量，形式为状态图形加数字）。
- 系统通知：只在窗口失焦或该会话不可见时发送，点击后跳到对应会话。Dock 角标显示 `needsAttention` 的数量。
- 快捷键：⌘1–9 切换会话，⌘J 跳到下一个需要处理的会话。
- **验收**：Figma 01 / 02 的侧栏在深色和浅色模式下像素级还原；同时运行 10 个会话时，状态变化在 1 s 内反映到侧栏。

### F3 即时回复 · ~~P0~~ 改为只做状态（v1.2）· Figma 02（PromptBar 已取消）
> 2026-10-16 起：PermissionRequest / AskUserQuestion 只用来把会话标成“等你处理”（侧栏、总览、通知、Dock 角标），hook 立即返回、不再挂起等待应用内作答，由 TUI 自己的对话框作答。以下为历史记录。
- **权限确认**：采用阻塞式 hook。hook 进程挂起，等待 GUI 返回 `{behavior: allow | deny}`，提供"允许一次 / 总是允许 / 拒绝"三个选项；120 s 超时后返回 `{}`，交回 TUI 原生提示处理。两边任何一方作答后，另一方立即撤下提示。
- **AskUserQuestion**：从 hook 的 `tool_input` 获取选项结构，用户点击后向 PTY 发送按键序列：单选直接按数字；多选按数字切换后 → Enter；"其他"选 N+1 后输入文本再 Enter。屏幕上识别 `❯ 1.` 编号菜单作为没有 hook 时的兜底。
- 作答方式：点击按钮；或在选项条可见、输入栏为空时直接按 1–9；输入栏有内容时按 ⌥1–9。
- 侧栏内联回复：在侧栏行内展开选项或输入框，无需切换会话（P1）。
- **验收**：Figma 02 的完整流程跑通；GUI 和 TUI 同时作答不会产生重复按键。

### F4 Worktree 生命周期 · P1 · Figma 06（New task sheet）/ 05（Merge sheet）
- 新建任务 ⌘N：选择项目和基线分支 → 输入任务描述 → 自动生成分支名（`<前缀>/<slug>`，中文标题回退为拼音或时间戳，可手动修改）→ 选择 agent → ↵。
- 后台执行：`git fetch` → `git worktree add --no-track -b <branch> ~/.tr/worktrees/<repo>/<name> <base>` → 记录 `branch.<name>.base` → 按 `.worktreeinclude` 用 `cp -c`（APFS 写时复制）复制被忽略文件 → 在可见终端里运行 setup 脚本 → 启动 agent 并送入首条 prompt。
- **脚本与端口**（v1.1 新增，参照 Conductor / Codex Local environments）：可以提交进仓库的 `.tr/settings.toml`，配置 `setup`、`run`、`archive` 三个脚本；会话头放一个 Run 按钮；按工作区分配端口段，注入 `TR_PORT`。
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
- 字号、行高、连字；终端不透明度；侧栏毛玻璃（`vibrancy: 'sidebar'`，终端区域保持不透明）。
- **终端底色永远跟随主题**（v1.2）：浅色模式为白色，深色模式为近黑色，和普通终端一样。原有的“背景：纯色 / 渐变 / 图片”选项已取消，旧设置里的渐变 / 图片在读取时丢弃。原因：渐变颜色是固定值，不随主题变化，会出现浅色主题配深色渐变、文字看不清的情况；而且渐变 / 图片要求终端透明，会退回到较慢的 DOM 渲染器。
- 设置页右侧实时预览；P2 支持导入 Ghostty / iTerm 主题。
- **验收**：Figma 07 / 08 还原；修改设置后，所有终端在 100 ms 内生效，且不需要重启会话。

### F8 全局 · P1
- ⌘K 命令面板（会话、项目、操作）· ⌘, 设置 · ⌘\ 收起或展开侧栏 · ⌘⌥B 收起或展开右侧面板。
- 键盘可以完成所有高频操作；支持减少动态效果；文字和状态的对比度达到 WCAG 2.2 AA。

### F9 状态总览 · P0 · Figma 11 v2（Section `106:3639`）
用户在一个页面里分诊所有 agent，不需要逐个切换会话。依据见调研 §2：Claude Code agent view、Superset Workspaces、Conductor、Vibe Kanban 等 8 家以上产品采用同一形态。v2（2026-10-17 确认）取代了旧版的“看板不画卡片”和“右侧只读预览”。
- **入口**：主区的一个视图，与终端互斥，不是弹窗。打开方式：侧栏“总览”或 ⌘⇧A；Esc 或 Enter 进入会话后回到终端。
- **列表（默认）**：跨项目按状态分组，顺序为 等你处理 → 出错 → 待审阅（`done_unread`）→ 运行中 → 空闲 → 已退出。已退出组默认折叠；分组的折叠状态会保存。分组标题只用文字、数量和细分隔线表达，不用色块。分组标题行和会话行都高 40，行内所有文字行高 20、严格垂直居中；分组之间用 12 的间距隔开。
- **每行**：StatusGlyph + 状态文字 · 标题 · `项目 › 分支` · 摘要（运行中显示当前动作；等你处理显示问题或待确认的命令；出错显示错误摘要；其他状态显示最后一句回复）· `+N −M` · 时间（等你处理显示“已等 3m”，运行中显示本轮用时，其余显示“5m 前”）· 悬停显示 ⌄。后续接入：todo `3/7`（F12）、`ctx 62%`（F11）、PR `#123 ✓`（F16），数据未就绪时这几列留空，不占位。
- **列表 · 原地展开（点行 / Space）**：在该行下方展开这个会话**完整、可交互的终端**——就是主区里同一个 xterm、同一个 PTY，搬到总览里显示，不新建进程，也不是快照。同一时间只展开一行，上方的行不动，下方的行顺延。托盘 `bg/hover` 底、圆角 5、内边距 4；终端默认高 420，拖托盘底边可调到 240 – 窗口高度 70%（会保存）。展开行隐藏 `+N −M` 和时间，换成“进入会话 ↵”和 ⌃。会话状态变化时托盘跟着它移到新分组，不会收起。收起：再点一次行、点 ⌃，或 Esc。
- **看板**：同一套分组画成列，列内是无描边的状态色块卡片（`card/<状态>` 底色，次要文字用同色相的 `card/<状态>-meta`，悬停换 `-hover`）；状态同时由 StatusGlyph 形状和列标题表达，不只靠颜色。列表和看板的分组永远一致。
- **看板 · 会话浮层（点卡片 / Space）**：居中模态浮层，宽 `min(窗口 − 240, 1200)`、高 `min(窗口 − 120, 780)`，圆角 10，1px `border/default` + Overlay 阴影；遮罩 `overlay/scrim` 盖住整个窗口（含侧栏）。48 高的标题栏：状态图形 · 会话名（13/600）· `项目 › 分支` ｜ 状态文字与时长 · 进入会话 ↵ · 关闭 ×；下面全部是该会话完整、可交互的终端。关闭：Esc、点遮罩、点 ×。
- **键盘**：↑↓ 移动（不带动已展开的终端），Enter 进入会话，Space 展开 / 收起（看板为打开浮层），Esc 先收起展开的终端或浮层、再离开总览。焦点在终端里时，所有按键（包括 Esc）都交给终端——agent 用 Esc 中断或拒绝；点终端外（行、标题栏）后 Esc 恢复上述含义。顶部过滤框支持文本、`p:项目`、`s:状态`。
- **批量操作**（P1）：⇧ 或 ⌘ 多选后可以停止、关闭，或发送同一条消息（调研 #18：广播只放在这里）。
- **验收**：Figma 11 v2（A 列表收起 / B 原地展开 / C 看板色块 / D 看板浮层）在深浅两套主题下还原；20 个会话时打开总览 < 100 ms；状态变化 1 s 内反映到行和分组；纯键盘可以完成“找到等你处理的会话 → 展开 → 进入会话”；在展开的终端里输入直接到达该会话的 PTY。

### F10 等待时长与有内容的通知 · P0（随 2b）
- 时间列的含义随状态切换：运行中显示本轮用时；等你处理显示“已等 3m”，超过 5 分钟后字重加粗，颜色不变；空闲 / 已完成显示“5m 前”。（合并 phase2 B5）
- 通知：标题写“项目 · 会话”，正文写问题、待确认的命令或最后一句回复；多个会话同时完成时合并成一条。（合并 phase2 B6）

### F11 上下文占用与额度 · P1
- wrapper 在按次注入的 `--settings` 里加一条 statusLine 命令，把 Claude Code statusLine JSON 中的 `context_window.used_percentage` 和 `rate_limits.five_hour / seven_day` 转发给 HookServer。如果用户已经配置了自己的 statusLine，必须串联调用它并原样输出它的结果，不能覆盖。
- 会话头显示 `ctx 62%`，超过 80% 时提示可以 `/compact`。额度显示在总览顶栏右侧，悬停可看重置时间。Codex 的接法待预研。

### F12 todo 进度 · P1
- 解析 PreToolUse 中 TodoWrite / Task* 的 `tool_input`，得出 `完成数 / 总数` 和当前项。侧栏行以文字或 1px 细进度线显示，总览显示 `3/7 · 当前项`。具体工具名需要先在 Claude 2.1.300 上实测。

### F13 一键 AI 审阅 · P1
- 变更面板和总览“待审阅”行提供“让 agent 审阅”：向该会话发送 `/code-review`（Claude）或 `/review`（Codex）。审阅结果留在 TUI 里，暂不解析回 diff。

### F14 端口检测 · P1
- 主进程低频扫描每个 PTY 子进程树正在监听的端口（`lsof`，按需开启），在会话行和总览中以小标签显示 `:5173`。点击在系统浏览器中打开，右键可以结束进程。内置浏览器为 P2。

### F15 归档 · P1（随 M4）
- 归档 = 停止 agent + 把 worktree 状态（含未提交的改动）存进私有 ref + 从侧栏隐藏。可以在⌘K“历史”中恢复，恢复时用 `--resume` 接上原对话。合并后可选自动归档。agent 运行中不允许归档。

### F16 PR / CI 只读状态 · P1（从 M6 提前）
- 检测到 `gh` 且已登录时，会话行和总览显示 `#123` 与 checks 状态（✓ / ✗ / 进行中）。CI 失败时提供“让 agent 修复”，由我们生成一条 prompt 发给该会话。创建和合并 PR 仍在 M6。

### P2 储备（已验证，但排在后面）
可编辑的消息队列（输入栏上方显示“已排队 2 条”）· 代码 checkpoint（`refs/tr/checkpoints/…`，对话部分交给 Claude 原生的 `/rewind`）· 历史会话搜索（其中“恢复旧对话”选择器为 P1，放进 ⌘K）· best-of-N 竞赛（依赖 M4，在总览中比较）· Claude Remote Control 菜单入口（发送 `/remote-control`，需要实测）· 仓库级预设 prompt（`.tr/settings.toml`）· 内置预览浏览器 · 实时终端网格（最多 4 格）。

## 5. 设计规范

- 唯一的设计来源是 Figma 文件中的 Foundations、Components、Screens 三页。屏幕节点：01 运行中 `14:2` · 02 等你处理 `16:178` · 03 变更审阅 `16:405` · 04 Git 图谱 `18:591` · 05 合并预检 `19:814` · 06 新任务 `19:940` · 07 设置·外观 `21:1223` · 08 浅色模式 `24:1790` · 09 侧栏入口 `51:1460` · 10 会话生命周期 `64:2225` · 11 v2 总览（Section `106:3639`；深色 A 列表收起 `106:3640` · B 列表原地展开 `106:4038` · C 看板色块 `108:4091` · D 看板浮层 `108:4366`；浅色 `108:5704` / `108:5757` / `108:5814` / `108:5866`；状态色块卡片与交互说明 `110:5348`；组件 OverviewGroupHeader v2 `104:145` · OverviewRow v2 `104:191` · StatusCard `104:286` · SessionOverlayBar `104:287`）。旧版 11 / 11b / 11c（`71:2635` / `72:2918` / `72:2617`）已被 v2 取代。
- 侧栏层级以 Components 页的 `ProjectHeader`（Default / Hover / Collapsed）和 `SessionRow` 为准，规则见 §3.3。总览组件在 Components 页的 Overview 分区：`OverviewGroupHeader` `70:222` · `OverviewRow` `70:324` · `BoardRow` `70:608`；`NavItem` 新增 `Show count` / `Count` 属性。
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

### 2b · 日常体验 + 总览（约 1.5 周）→ v0.2.0（v1.1 插入）
- 进度（2026-10-16）：B10–B13、§3.3 侧栏层级、F9 总览已合入 main；B 类中与输入栏 / PromptBar 有关的条目（B7 部分、B12）随 v1.2 作废。
- phase2 计划的 B 类全部条目，加上 UX 走查 #11 / #12；§3.3 的侧栏层级修正；F9 总览（列表、看板、预览、就地作答）；F10。
- **完成标准**：Figma 09 / 11 还原；UX 走查 P0 / P1 全部关闭。

### M4 · Worktree 全链路 + Diff 审阅（约 3 周）→ v0.3.0
- F4 新建任务、`.worktreeinclude`、setup / run / archive 脚本与 `TR_PORT`、合并预检、merge / squash / rebase、冲突交给 agent、清理。
- F5 变更面板 + 行内评论发给 agent；F13 一键 AI 审阅；F15 归档。
- 并行可做：F11 上下文与额度、F12 todo 进度、F14 端口检测（与 git 无关，可以单独成路）。
- **完成标准**：Figma 03 / 05 / 06 还原；L1 / L4 / L5 完整跑通；git 相关操作有基于临时仓库的集成测试。

### M5 · Git 图谱 + PR 状态（约 2 周）→ v0.4.0
- F6 lane 算法、worktree / agent 标注、右键操作、虚拟化、Worktree 列表。
- F16 PR / CI 只读状态。
- **完成标准**：Figma 04 还原；5000 个提交的仓库性能达标。

### M6 · 深化（持续进行）→ v1.0
- 会话在应用重启后保留（PTY 守护进程 + `claude --resume`）；`@` 文件引用。（侧栏内联回复已由 F9 总览里原地展开的终端实现）
- GitHub PR 创建 / 合并流程（`gh`）；导入 Ghostty / iTerm 主题；孤儿 worktree 自动回收；“P2 储备”中的各项。
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
| 09 侧栏 · 项目与会话入口 | 2b（§3.3 层级修正） |
| 10 会话生命周期 | 2a |
| 11 v2 总览（列表原地展开 / 看板色块 + 浮层） | 2b |
| 12 会话头：ctx % · todo · 端口 · PR（待设计） | M4 并行路 / M5 |

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
