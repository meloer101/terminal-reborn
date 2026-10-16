# 已验证优秀的功能：我们还缺什么（2026-10-16）

> 范围：在 `docs/PRD.md`、`docs/acceptance/ux-review-2026-10-15.md` §4、`docs/research/2026-10-13-competitive-research.md`、`docs/phase2/plan.md` 的基础上补充，已经写过的结论不再重复。
> 「已验证优秀」的判定标准，至少满足一条：① 3 家及以上竞品各自独立做了（说明是共识）；② 官方 changelog 把它作为一次版本的头条，或明确写着来自用户请求；③ HN / Reddit 上有用户点名称赞，或抱怨缺少它。
> 证据等级：**强** = 满足两条及以上；**中** = 满足一条；**未确认** = 只有厂商自述或单一来源。

## 0. 结论（先看这里）

1. **状态总览（用户点名要的）已经是共识形态**：按「需要你做什么」分组的**列表**为主视图，**看板**作为同一组数据的另一种视图。Claude Code agent view、Superset Workspaces 页、Conductor 状态分区、Vibe Kanban / Emdash / Nimbalyst 看板、Copilot mission control、Warp Agent Management Panel 都是这个方向。最值得照抄的一条原则来自 Superset：「列表和看板用同一套分组，两种视图永远不会矛盾」。
2. **行内信息密度决定总览有没有用**。各家行内都有的字段：状态、项目 / 分支、一句话摘要（当前动作或最后一句回复）、**已等待时长**、diff 大小、PR / CI 状态、最近活动时间。我们现在缺的是：等待时长、摘要（B2 / B5 已在计划里）、**上下文占用 %**、**todo 进度**、PR / CI。
3. **上下文与额度可见**是 2026 年各家都补上的能力：Claude 桌面版的 usage ring、Conductor 的 context dial（悬停显示明细和 Codex 额度）、Orca 和 Superset 的 Usage 页。Claude Code 的 statusLine JSON 已经直接提供 `context_window.used_percentage` 和 `rate_limits.five_hour / seven_day`，我们接入的成本很低。
4. M4 那条链路（setup / run 脚本、diff 评论发回 agent、归档）已被市场充分验证，按原计划做即可。另外建议补两项低成本的：**端口检测**和 **AI 审阅按钮**。
5. 不建议现在做：自绘对话 UI、定时自动化、云端工作区、自研手机 App。Claude 的 Remote Control 是 CLI 原生功能，我们给一个入口就够了（未实测）。

## 1. 候选功能排行

| # | 功能 | 谁有 | 为什么算「已验证优秀」（证据） | 我们现状 | 优先级 | 设计要点 |
|---|---|---|---|---|---|---|
| 1 | **状态总览：按需要你做什么分组的列表 ⇄ 看板** | Claude Code agent view；Superset Workspaces；Conductor（0.35 状态分区，0.85 自定义分区）；Vibe Kanban；Emdash；Nimbalyst；Copilot mission control；Warp | **强**：8 家以上都做了；Superset 08-16 changelog 的头条；Conductor 0.33.5 先放在实验开关后，0.35 转正为默认；Vibe Kanban 用户评价「自 Cursor 以来最大的效率提升」（官网引言） | 只有侧栏的「等你处理」队列；PRD M6 写的是「多会话总览网格」 | **P0** | 主区新增「总览」视图。默认是按状态分组的列表，可切换成看板，两者分组相同。详见 §2 |
| 2 | **等待时长 + 有内容的通知 + 跳到最早未读** | cmux（通知正文、⌘⇧U）；Superset（通知写明项目、工作区、问题）；Claude agent view（`waiting 3m`）；Conductor（每个 toast 链接到对应工作区） | **强**：cmux 作者在 Show HN 帖（198 分）里说明的做产品动机，正是通知只有一句「Claude is waiting for your input」；Reddit 上有人抱怨 agent 等审批空等了 10 分钟自己却不知道 | B5 / B6 已在计划内，⌘J 已有 | **P0**（随 2b） | 行内显示「已等 3m」，超过阈值后加粗，但不改变颜色；通知标题写「项目 · 会话」，正文写问题或最后一句 |
| 3 | **上下文占用 % + 计划额度（5h / 7d）** | Claude 桌面版 usage ring；Conductor context dial（悬停看明细，0.75 起支持 Codex 额度）；Orca「Usage & rate-limit tracking」+ 账号切换；Superset Usage 页、侧栏 usage tab | **强**：4 家都做了；Claude Code 应社区 issue #27915 的请求，在 v2.1.80 把 `rate_limits` 加进 statusLine JSON；HN 上有专门做这个看板的 Show HN | 没有 | **P1**（实现成本低） | wrapper 在注入的 `--settings` 里加一条 statusLine 命令，把 JSON 转发给 HookServer。如果用户已有自己的 statusLine，必须串联调用并原样输出它的结果，不能顶掉。会话头显示 `ctx 62%`；全局额度放到标题栏右侧 |
| 4 | **todo / 计划进度 n/m** | Conductor（0.33 Tasks；Todos 未完成时阻止合并）；Codex app task sidebar（显示 plan）；Claude 桌面版 tasks / plan 面板；Superset 把子 agent 挂在父 agent 下 | **中**：3 家以上都做了，各家形态不同 | 没有（当前动作只取单个工具调用） | **P1** | 从 PreToolUse 拿到 TodoWrite / Task* 工具的 `tool_input`，解析出 `3/7` 和当前项。侧栏行用一条细进度线展示，总览里显示文字。Claude 2.1.300 的工具名需要实测（**未确认**） |
| 5 | **Diff 审阅 + 行内评论合并发回 agent** | Conductor、Codex app、Claude 桌面版（⌘↵）、Vibe Kanban、Orca、Superset、Emdash、Copilot | **强**：全员都有；Vibe Kanban 的核心卖点 | M4 计划中 | **P0**（M4） | 照 Vibe Kanban 的做法：所有评论合并成一条消息发出，任务回到「运行中」。附件以路径形式送入输入栏 |
| 6 | **一键 AI 审阅** | Conductor Review 按钮（支持仓库级审阅偏好）；Claude 桌面版「Review code」（评论直接写进 diff）；Codex `/review`（对比基线或未提交改动） | **强**：3 家大厂都做了 | 没有 | **P1** | 我们保留原生 TUI，最便宜的做法是「审阅」按钮直接给会话发 `/code-review` 或 `/review`。结果仍留在 TUI 里，暂不解析回 diff |
| 7 | **setup / run / archive 脚本 + 每个工作区独立端口** | Conductor（`.conductor/settings.toml`，`CONDUCTOR_PORT`，run_mode）；Codex「Local environments」（setup + 顶栏 Actions 按钮）；Superset terminal scripts / presets bar | **强**：3 家都有，并且都支持把配置提交进仓库 | M4 有 setup + `.worktreeinclude`，没有 run / archive，也没有端口变量 | **P1**（M4） | 配置文件 `.tr/settings.toml` 可提交进仓库；Run 按钮放在会话头；注入 `TR_PORT`（按工作区分配一段端口） |
| 8 | **监听端口检测（点击跳到对应终端或在浏览器打开）** | cmux 侧栏每行都显示端口；Superset Port Management（`.superset/ports.json` 标签、点端口可结束进程）；Cloud 版也有 | **中**：cmux 和 Superset 都把它放在侧栏一等位置，cmux 还专门修过「agent 启动的 dev server 端口不显示」的 bug | 没有 | **P1** | 主进程按 PTY 子进程树做低频 `lsof` 扫描（cmux 为此专门优化过性能，见其 0.65 changelog）。端口以小标签显示在行内 |
| 9 | **内置预览浏览器 / Design Mode** | Claude 桌面版 Browser pane；Cursor 3 Design Mode；Orca；Superset；cmux（可脚本化）；Vibe Kanban | **强**：5 家以上都做了 | 没有（PRD 非目标） | **P2** | 先做 #8，点击端口时用系统浏览器打开；内置浏览器先不做 |
| 10 | **归档工作区（保存 git 状态，可恢复）+ PR 合并后自动归档** | Conductor（0.33.5：归档时连同未提交文件一起保存，随时可恢复；agent 运行中不允许归档）；Claude 桌面版（PR 合并或关闭后自动归档）；Zed（Thread History 恢复）；Codex（自动清理旧 worktree） | **强** | 只有「关闭会话」，没有归档 | **P1** | 归档 = 停掉 agent + 把 worktree 状态存进私有 ref + 从侧栏隐藏。「历史」里可以恢复，恢复时用 `--resume` 接上原对话 |
| 11 | **PR / CI 状态 + 自动修复 / 自动合并** | Claude 桌面版 CI 状态条（Auto-fix / Auto-merge，CI 完成时通知）；Conductor Checks 页；Superset 行内 checks 进度；cmux 侧栏 PR 状态；Emdash；Copilot | **强** | M6 | **P1**（只读部分提前做） | 先做只读：用 `gh` 在行内显示 `#123 ✓ / ✗`；修复 CI 由我们生成一条 prompt 发给会话 |
| 12 | **可编辑的消息队列** | Conductor（0.54 重做队列：每条可编辑、删除、立即发送，编辑时暂停发送；0.62 加了键盘操作）；Cursor 3.2 能把队列里的消息转成并行子任务 | **中**：Conductor 为它做了两个版本 | 发送协议在 agent 忙时会排队，但队列看不到也不能编辑 | **P2** | 输入栏上方显示「已排队 2 条」，可以展开、编辑、删除。忙时如果不想排队，⌘↵ 立即插话 |
| 13 | **checkpoint / 回退一轮** | Conductor（每轮开始前把工作区存进私有 git ref，可回退代码和对话）；Orca「Worktree checkpoints」；Claude 原生 `/rewind` | **中** | M6 | **P2** | Claude 原生已经能 rewind，我们只补「代码快照」部分：在 UserPromptSubmit 时写入 `refs/tr/checkpoints/<session>/<n>` |
| 14 | **会话历史 / 跨会话搜索、恢复旧对话** | Orca（跨机器会话搜索，10-15 版本）；Copilot（自然语言搜索历史）；Claude agent view `/resume` 选择器；Zed Thread History；Superset 跨工作区搜索 | **中** | 没有 | **P2**（「恢复旧对话」选择器是 P1） | ⌘K 里加「历史会话」，读取 `~/.claude/projects/*.jsonl` 的标题和首条 prompt（只读）；选中后用 `--resume` 新开会话 |
| 15 | **同一任务交给 N 个 agent 竞赛（best-of-N）** | Cursor（`/best-of-n`、Use Multiple Models）；Emdash Best-of-N；Superset 和 Orca 都写了「Race agents」使用指南 | **中**：4 家都有；Cursor 2.0 发布时把它当作主卖点 | 没有 | **P2** | 依赖 M4。新建任务时把 agent 数量设为 N → 建 N 个 worktree → 总览里并排比较 diff 统计和自述摘要 → 选中一个合并，其余归档 |
| 16 | **手机远程** | Claude Remote Control（CLI 原生，端到端加密，推送通知）；Conductor iOS（0.90）；Superset Mobile；cmux iOS beta；Orca 移动端；Codex（ChatGPT 手机端） | **强**（但对我们是生态项） | 没有（PRD 非目标） | **P2** | 不自研 App。给 Claude 会话加一个菜单项「开启 Remote Control」，发送 `/remote-control`。在我们的 PTY 里能否正常工作**未确认**，需要实测 |
| 17 | **prompt 片段 / 仓库级预设 prompt** | Conductor（审阅、建 PR、修错、解冲突各有一套仓库级偏好）；Cursor 可共享的团队命令；Superset presets 栏；Jean「Magic Prompts」 | **中** | 没有 | **P2** | 先做「冲突交给 agent」「发送评论」这几个内置 prompt 的仓库级覆盖（配置写在 `.tr/settings.toml`），再考虑通用片段库 |
| 18 | **广播：一条消息发给多个会话** | Seshions（Show HN，只有 2 分）；iTerm 的 broadcast input | **未确认**：没找到它被广泛称赞的证据；Orca 的竞赛指南明确写的是「把同一个 prompt 分别粘贴进去」 | 没有 | **P2** | 只放在总览的多选批量操作里，不单独做入口 |

不进表的内容：定时自动化（Codex / Superset / Orca 都有，但偏离我们「终端」的定位）；Issue → 任务（Emdash / Orca / Jean 有，留到 M6 和 PR 一起做）；Sculptor 的 Pairing Mode / Conductor 的 Spotlight（把 worktree 改动同步到仓库根目录测试，有用户称赞，适合单端口的重型项目。我们可以在 M4 之后评估，**P2**）。

## 2. 总览 / Dashboard 的几种形态

### 2.1 市面上的四种做法

**A. 按需要你做什么分组的列表**（证据最强，推荐作为主视图）
- **Claude Code agent view**（`claude agents`，全屏 TUI）：按状态分组，置顶的会话和「需要你」的会话排在最上面。分组顺序：`Ready for review`、`Needs input` 在 `Working`、`Completed` 之前；`Completed` 同时收纳已完成、失败、已停止的会话。每行只有三项：名称、当前活动的一句话摘要、时长（会话结束后时长冻结）。PR 链接 `#N` 放在最右边。按 Space 打开 peek 面板，显示 PR 和「waiting 3m」，并可以直接回复；按 Enter 进入会话。过滤语法：`s:blocked`、`n:login`、`#1234`。⌃S 在按状态分组和按目录分组之间切换，⌃T 置顶，⇧↑↓ 调整顺序。
- **Superset Workspaces 页**（08-16）：分组依次为 Needs attention / Working / Needs review / Idle / Merged。每行显示实时 agent 状态、diff 大小、PR checks 进度、最近活动时间；可按活动时间、创建时间、diff 大小、名称排序；分组可折叠，折叠状态会记住。早期版本（01-06）的状态只有 3 种颜色：琥珀 = 运行中，红 = 需要授权，绿 = 待审阅。点一下「待审阅」就转为空闲（视为已读）。
- **Warp Agent Management Panel**：本地和云端的 run 放在同一个列表，可按来源、状态、创建者过滤，子 agent 单独成行。

**B. 看板**（同一套分组画成列）
- **Vibe Kanban**：列由事件自动推进：创建 workspace 时进入 In Progress，开 PR 时进入 In Review，所有 PR 合并后进入 Done；审阅评论发出后任务回到 In Progress。
- **Superset 看板视图**：与列表用同一套分组，工具栏上的开关在两种视图之间切换。
- **Conductor**：在侧栏里按 backlog / in progress / in review / done 分区，有 PR 时用 PR 标题作为工作区名。
- **Emdash / Nimbalyst**：看板上「谁做完了、谁需要输入」一目了然；Nimbalyst 允许拖拽调整阶段。
- 反面意见（证据**中**）：有评测指出，看板适合有明确终点、能写成一张卡的任务；探索型会话不适合用看板。Cline 的看板发布文也承认，真正的瓶颈是人的注意力，而不是列本身。

**C. 实时终端网格**
- Cursor 3 的 Agent Tabs 可以并排或网格显示多个对话；Claude 桌面版的窗格可以自由拖放；Superset 和 cmux 支持分屏。
- 风险：HN 上有人指出 xterm.js 在终端很多或很大时吃力，Conductor 因此下线了「big-terminal」模式（单一来源，**中**）。另外，Chromium 能同时保持的 WebGL context 数量有上限，不可能让 10 个以上终端同时以 WebGL 实时渲染。

**D. 时间线 / 收件箱**
- Orca Agents feed：把各 worktree 的完成、阻塞、回复预览按时间排成一条线，运行中的置顶；有未读角标，⌘F 过滤，支持多选批量操作。
- cmux 通知面板：一键跳到最新未读（⌘⇧U）。
- Codex Automations 的 Triage 收件箱：可以只看未读。

### 2.2 建议 TerminalReborn 的总览方案

- **入口**：主区的一个视图，不用弹窗。快捷键 ⌘⇧A（或 ⌘0），侧栏顶部的 NavItem 上加一个「总览」入口。
- **默认是列表，按状态分组**，顺序为：等你处理 → 出错 → 待审阅（`done_unread`，或已完成但有未合并的 diff）→ 运行中 → 空闲 → 已退出（默认折叠）。每组标题旁显示数量。分组标题只用文字、字重和细分隔线区分，不用色块。
- **每行的列**（从左到右）：StatusGlyph + 状态文字 · 标题 · `项目 › 分支` · 摘要（运行中显示当前动作，其他状态显示最后一句回复）· todo `3/7` · `ctx 62%` · `+N −M` · 时间（等你处理时显示「已等 3m」，运行中显示本轮用时）· PR `#123 ✓`（M6 前留空）。
- **看板模式**：同一套分组画成列。列内仍然是一行一项、用细线分隔的紧凑行，不用卡片，以符合我们的设计约束。
- **Space = 预览**：右侧滑出面板，显示该会话**终端最后约 15 行的文本快照**（从 xterm buffer 读取，不新开 WebGL 实例），以及待回答的问题或权限选项。选项可以直接点，复用 F3 的 PromptBar，这样也就实现了 PRD 里的「侧栏内联回复」。这是我们相对 GUI 型竞品的独特优势：预览看到的是 agent 真实的 TUI。
- **键盘操作**：↑↓ 移动，Enter 进入会话，Space 预览，1–9 直接作答，⌘⌫ 归档，⇧ 点选或 ⌘ 点选多行后批量操作（停止、归档、发送同一条消息，见表中 #18）。
- **过滤**：沿用 agent view 的语法（`s:等你处理`、`p:项目名`、文本），放在顶部一个搜索框里。
- **实时网格**：只作为 P2 的可选项，最多同时显示 4 格，其余显示文本快照。

## 3. 侧栏层级的几种做法

| 产品 | 层级 | 每行内容 | 其他 |
|---|---|---|---|
| Conductor | 仓库 › 工作区 › （工作区内可开多个对话标签） | 工作区名（自动生成的城市名，或 PR 标题）+ 状态 | 0.85 支持自定义分区（右键分区标题编辑）；⌘1–9 会跳过已折叠分区里的工作区；有 PR 时用 PR 标题作为名称；归档后放入 History 面板 |
| Superset | 项目 › （分组 / 标签文件夹，可拖到任意位置）› 工作区；顶部有 Pinned 和 Sessions 分区 | 08-02 重新设计成更紧凑的行：图标去色，用 keycap 样式显示快捷键提示；**端口和正在运行的 agent 以小标签放在行下方**；子 agent 挂在 agents 标签下 | 分区都能折叠；能从 CLI 或 agent 给工作区打标签，它会自动归入对应文件夹；支持批量操作 |
| cmux | 平铺的竖向标签，一行就是一个工作区 | 多行：标题、git 分支、目录、端口、关联的 PR 状态、最新一条通知文字；有窗格需要你时，窗格周围亮一圈蓝色光环 | 0.65 加了「Compact Agent Status」：把 agent、PR、分支状态合成一个小图形，详情放在 tooltip 和 VoiceOver 里 |
| Codex app | 项目 › 线程 | 未读时显示蓝点（社区在请求加「标记完成」，**未确认**是否已上线） | 线程可以在本地和 worktree 之间 Handoff；有用户报告旧线程会从 UI 里消失（**未确认**） |
| Claude 桌面版 | 默认是平铺的会话列表，可选按项目分组 | 会话名 + 状态 | 顶部有过滤（按状态、项目、环境）；PR 合并后自动归档 |
| Zed | Threads Sidebar 按项目分组 | 线程，可以混用不同 agent | 停止、归档、新建都能在侧栏一键完成；⌘G 打开 Thread History 恢复；⌃Tab 在最近线程间切换 |
| Orca | 仓库 › 工作区（04 版本把 Worktrees 改名为 Workspaces） | 实时 agent 状态（1.3.41 起） | 另有 Agents feed 作为跨工作区的收件箱 |

**观察到的共识**
1. 当前可见的层级几乎都只有**两层**：项目 › 工作区（或会话）。工作区和会话是一对多时，会话以标签或小标签的形式出现，不再多缩进一层。
2. 行是**密集**的：主标题一行，次要信息一行（分支、端口、摘要）。状态用一个固定宽度的图形列，让所有标题左对齐。
3. 都提供**可折叠、可自定义的分区或分组**，以及置顶。

> **采纳情况（2026-10-16）**：下面这条建议里“项目标题 12px、次要色”的部分**没有采纳**。作者的要求是：项目包含会话，项目标题不能比会话标题更弱。最终规则见 PRD §3.3：项目标题 13px / 600 / 主文字色，配折叠箭头；会话缩进到项目名下方，标题用 13px / 400。“等你处理”队列也不再采用，侧栏严格按项目排列，按状态的视图交给总览。

**对 TerminalReborn 的建议**（字号为设计建议，不是从竞品测量的数据）
- 视觉上把三级压成两级：项目标题 12 px、字重 600、次要文字色，不缩进；工作区和会话合并成一行（多数 worktree 只有一个 agent），主标题 13 px，第二行 11–12 px、三级文字色，显示 `分支 · 摘要`。
- 同一个 worktree 里有多个会话时，才展开第三级：缩进 16 px，用细竖线连接，不用折叠三角。
- 状态图形列宽固定 16 px，状态文字只在第二行显示，满足「状态不只靠颜色」。
- 行右侧固定显示一个元素：「已等 3m」或 `+N −M`，二选一。端口和 PR 只在悬停时显示，或放在总览里，避免侧栏过载。
- 分区：「等你处理」队列（已有）、置顶、按项目。项目可以折叠，折叠后标题上显示需要你处理的数量。

## 4. 来源

总览 / 状态
- Claude Code agent view：https://code.claude.com/docs/en/agent-view
- Claude Code 并行方式对比：https://code.claude.com/docs/en/agents.md
- Superset Workspaces 分诊页（2026-08-16）：https://superset.sh/changelog/2026-08-16-workspaces-triage-editable-markdown
- Superset changelog（状态色、侧栏重新设计、通知内容、Usage、子 agent）：https://superset.sh/changelog
- Conductor 0.35 Workspace Status：https://www.conductor.build/changelog/0.35.0-workspace-status ；changelog 第 9 页：https://www.conductor.build/changelog/page/9
- Conductor 0.85 Sections / 队列：https://conductor.build/changelog
- Vibe Kanban 首页（用户引言）：https://www.vibekanban.com/ ；Cloud（状态自动推进）：https://www.vibekanban.com/blog/introducing-vibe-kanban-cloud ；审阅文档：https://www.vibekanban.com/docs/core-features/reviewing-code-changes ；关停公告：https://www.vibekanban.com/blog/shutdown
- Emdash：https://www.emdash.sh/ ；文档：https://docs.emdash.sh/
- Nimbalyst 并行会话看板：https://nimbalyst.com/parallel-claude-code-sessions
- Copilot mission control：https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/ ；会话管理：https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents
- Warp 管理面板：https://docs.warp.dev/platform/managing-cloud-agents
- Cursor 3（Agents Window、Agent Tabs 网格、/best-of-n）：https://cursor.com/changelog/3-0 ；3.2：https://cursor.com/changelog/04-24-26 ；2.0：https://cursor.com/changelog/2-0
- Zed Parallel Agents：https://zed.dev/blog/parallel-agents ；https://zed.dev/docs/ai/parallel-agents.html
- Orca Agents feed：https://www.onorca.dev/docs/activity ；竞赛指南：https://www.onorca.dev/docs/recipes/parallel-agents ；changelog：https://www.onorca.dev/changelog
- 看板适用性：https://cline.bot/blog/announcing-kanban ；https://www.codeagentswarm.com/en/guides/vibe-kanban-vs-codeagentswarm

用户声音
- cmux Show HN（198 分）：https://news.ycombinator.com/item?id=47079718 ；发布复盘：http://cmux.com/blog/show-hn-launch
- Superset Show HN（xterm.js 在大终端下吃力、Conductor 下线 big-terminal）：https://news.ycombinator.com/item?id=46368739 ；Launch HN：http://news.ycombinator.com/item?id=48236770
- Offrun Show HN（批评工具都把工作呈现为对话记录、横向标签不适合 30 个会话）：https://news.ycombinator.com/item?id=49942434
- Claude Control Show HN（hooks 的边界情况）：https://news.ycombinator.com/item?id=47765520
- 多会话看板 Show HN（上下文、子 agent 可见性）：https://news.ycombinator.com/item?id=47314375
- Reddit「agent 空等 10 分钟」：https://www.reddit.com/r/ClaudeAI/comments/1rzgmm9/i_run_35_claude_code_agents_in_parallel_heres_the/
- Seshions 广播：https://news.ycombinator.com/item?id=47232758

上下文 / 额度 / 进度
- Claude 桌面版（usage ring、Review code、CI Auto-fix / Auto-merge、自动归档、过滤与分组）：https://code.claude.com/docs/en/desktop ；改版博客：https://claude.com/blog/claude-code-desktop-redesign
- statusLine JSON（`context_window`、`rate_limits`）：https://code.claude.com/docs/en/statusline ；需求 issue：https://github.com/anthropics/claude-code/issues/27915
- Conductor context dial 与 Codex 额度（0.75）：https://www.conductor.build/changelog/page/3 ；Tasks（0.33）：https://www.conductor.build/changelog/page/10 ；Todos：https://www.conductor.build/docs/reference/todos
- Codex app 功能（task sidebar 显示 plan）：https://developers.openai.com/codex/app/features

运行 / 脚本 / 端口 / 归档 / checkpoint
- Conductor Scripts：https://www.conductor.build/docs/reference/scripts ；Spotlight：https://docs.conductor.build/guides/spotlight-testing ；Checkpoints：https://www.conductor.build/docs/reference/checkpoints ；Workflow（归档与恢复）：https://www.conductor.build/docs/concepts/workflow ；队列（0.54 / 0.62）：https://www.conductor.build/changelog/page/5
- Codex Local environments：https://developers.openai.com/codex/app/local-environments ；Review：https://developers.openai.com/codex/app/review ；Automations：https://developers.openai.com/codex/app/automations
- Superset 端口：https://docs.superset.sh/ports ；终端脚本：https://docs.superset.sh/terminal-scripts
- cmux README（侧栏字段、通知光环）：https://github.com/manaflow-ai/cmux ；changelog 0.65：https://cmux.com/docs/changelog
- Sculptor Pairing Mode：https://imbue.com/sculptor

手机
- Claude Remote Control：https://code.claude.com/docs/en/mobile
- Conductor iOS（0.90）：https://www.conductor.build/changelog
- Orca 移动端（1.4.100）：https://www.onorca.dev/changelog/1-4-100

其他
- Jean（Magic Prompts）：https://github.com/coollabsio/jean ；https://aicoolies.com/reviews/jean-review
- Codex app 未读蓝点讨论：https://community.openai.com/t/mark-thread-completed-in-codex-app/1384026
- 本次没有覆盖：Kiro、Terragon（没有检索到 2026 年的新信息）。
