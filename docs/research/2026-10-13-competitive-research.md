# TerminalReborn 竞品与技术调研报告

> 日期：2026-10-13 · 平台假设：macOS（Apple Silicon）
> 方法：对 17 个开源仓库浅克隆后只读源码（未安装、未构建、未运行），结合官网文档、changelog、GitHub issues、HN 讨论；闭源产品（Conductor）通过文档与 changelog 调研。Claude Code 闭源部分的结论来自二进制 `strings` 反查，已标注。
> 本机环境：Claude Code 2.1.289、Codex CLI 0.142.5、已安装 Orca（其全局 hooks 在 `~/.claude/settings.json`、`~/.codex/hooks.json`）。

---

## 0. 一页结论

**你的 5 个需求，市面上没有任何一个产品同时做好。** 每一项都有"做得最好的那家"，但没有人把它们拼在一起：

| 需求 | 做得最好的 | 现状空白 |
|---|---|---|
| ① 桌面级输入框（可选中删除） | **cmux** TextBox（NSTextView）、**Warp** Rich Input、**Nimbalyst** CLI 模式 | 多数产品要么没有（Orca/Superset 默认、Emdash TUI、claude-squad、ccmanager、Wave），要么用 GUI 聊天**替换**了 TUI（Conductor、Vibe Kanban、Crystal、opcode）。"常驻 composer + 原生 TUI 并存"只有 cmux（beta）真正做到 |
| ② 美观 + 中英文字体分开 + 背景 | **Warp**（YAML 主题、渐变、背景图）、**Wave**（任意 CSS 背景 + 毛玻璃） | **没有一家提供"英文字体 / 中文字体"两个独立 GUI 选项**。cmux 靠 Ghostty 配置文件 `font-codepoint-map`；其余只能在 fontFamily 里手写逗号列表 |
| ③ 侧边栏状态 + 快速点选选项 | **cmux** Feed（权限/计划/AskUserQuestion 全可点）、**Conductor**（GUI 原生）、**Orca**（hook 载荷驱动的卡片，但仅在实验性 Chat UI） | 在**原生 TUI 视图**旁边直接点选选项的，只有 cmux 和 Calyx（小众） |
| ④ Worktree 管理与合并 | **Conductor**（全生命周期）、**Vibe Kanban**（合并/冲突最完整）、**Crystal**（本地 rebase+squash+ff） | 主流（Orca/Superset/Emdash/Conductor）都**只走 GitHub PR**，本地合并到 main 基本缺位（Emdash #1269 呼声很高）；cmux 官方拒绝做 worktree |
| ⑤ Git 树可视化（含 worktree） | **Orca**（VS Code 风格 swimlane SVG）、**Farol**（自研 lane + 三栏冲突解决器，16★） | **没有一家把"每个 worktree 的 HEAD + 其 agent 状态"标在提交图上**——这是最干净的差异化点 |

**技术路线建议（详见 §4）：**
1. **保留原生 TUI，在其上叠加结构化层**（不要走 headless 自绘聊天的路线）。
2. **框架选 Electron + xterm.js 6.1 + node-pty + React**；终端层抽象接口，为将来换 libghostty 留口子。
3. **状态以 hooks 为权威信号**，通过 `--settings` wrapper 按次注入（不污染用户全局配置），屏幕/标题/OSC 只做兜底。
4. **选项点选优先走 hook 结构化数据**（PermissionRequest / AskUserQuestion 的 `tool_input`），作答走"阻塞 hook 返回决策"或"向 PTY 发数字键"。
5. **Composer 发送协议**：bracketed paste 写正文 → 闭环确认（buffer 中出现文本/占位符）→ **单独**写 `\r`。

---

## 1. 调研对象

| 产品 | 形态 | 协议 | 热度/活跃 | 一句话 |
|---|---|---|---|---|
| **Orca** (stablyai/orca) | Electron + xterm.js 6.1β | **MIT** | 91.5k★，每日提交 | 功能最全的开源 ADE；IME 处理最深；有提交图；你本机已装 |
| **cmux** (manaflow-ai/cmux) | Swift/AppKit + libghostty | GPL-3.0 | 28k★，每周发版 | 原生、输入框 + Feed 快速回复最强；拒绝做 worktree；内存问题多 |
| **Superset** (superset-sh/superset) | Electron + xterm.js 6.1β | **ELv2**（限制性） | 15k★，活跃 | PTY 守护进程最工程化；⌘I rich input；无本地合并/冲突 UI |
| **Emdash** (generalaction/emdash) | Electron + xterm.js 6.0 | Apache-2.0 | 6k★，YC W26 | "只用 hooks、绝不解析屏幕"的纪律；TUI 模式无点选 |
| **Conductor** | Tauri，闭源 | 闭源 | 每周发版 | GUI 对话 + worktree 全生命周期的标杆；TUI 只能二选一 |
| **Warp** | Rust 自研 GPU UI | AGPL-3.0（UI crate MIT） | 65k★ | Rich Input 叠在 TUI 上；OSC 777 agent 协议；YAML 主题 |
| **Wave** (wavetermdev/waveterm) | Electron + Go | Apache-2.0 | 22.5k★ | 背景系统最灵活（任意 CSS + vibrancy）；无 agent 深度集成 |
| **Nimbalyst** (Crystal 后继) | Electron + ghostty-web | MIT | 1.9k★，活跃 | "真 TUI + GUI 输入框 + 结构化交互"混合路线，代码注释即避坑手册 |
| Crystal | Electron | MIT | 已废弃（2026-02） | 本地 rebase/squash/ff-only 合并 + `merge-tree` 冲突预检 |
| Vibe Kanban | Rust + React | Apache-2.0 | 28k★，**公司已关停** | headless 结构化路线天花板；合并/冲突/清理最完整 |
| ccmanager | Bun + Ink TUI | MIT | 1.3k★，每周发版 | 屏幕状态规则最精细；`.worktreeinclude`；自动审批双层防护 |
| claude-squad | Go + tmux | AGPL-3.0 | 8.6k★，疑似停更 | 反面教材（屏幕哈希判 busy、固定 sleep、AutoYes） |
| opcode (原 Claudia) | Tauri | AGPL-3.0 | 22k★，停更 | headless 路线的典型代价（无 Plan Mode、中文 issue 多） |
| Supacode / Farol / Calyx / Zentty | Swift + libghostty | FSL / MIT / MIT / GPL | 小众 | 分别在 worktree、**git 图 + 冲突解决**、Approval Inbox、状态协议上各有亮点 |

---

## 2. 需求逐项分析

### 2.1 需求①：桌面级输入框

**两种路线：**
- **替换路线**（Conductor、Vibe Kanban、Crystal、opcode）：用 `claude -p --output-format stream-json` 或 Agent SDK / ACP 驱动 agent，自己渲染聊天 UI，输入框天然是原生的。代价：丢失 slash 命令菜单、Plan Mode 交互、`/compact`、插件 UI；必须跟进上游输出格式（Conductor changelog 里反复出现 "Fix … parsing for latest Claude Code output format"）；opcode #394 "没有 Plan Mode"。Conductor 后来又加回 Big Terminal Mode，说明重度用户需要原生 TUI。
- **叠加路线**（cmux TextBox、Warp Rich Input、Superset ⌘I、Nimbalyst CLI 模式、Orca Native Chat 实验版）：TUI 照常运行，在其下方/上方放原生编辑器，提交时把文本写进 PTY。**这是 TerminalReborn 应走的路线。**

**把文本可靠地送进 TUI——各家踩过的坑汇总：**

| 坑 | 证据 | 对策 |
|---|---|---|
| 正文和 `\r` 同一次 write → 回车被当作粘贴内的换行吞掉，消息停在输入框 | Orca `agent-prompt-injection.ts:10`、Superset `terminal.ts:499`（#6243）、claude-squad、Emdash 注释 "Claude Code discards the pasted text when any byte follows the paste-end marker in the same write" | `\r` **必须单独一次 write**，且等待 |
| 大段文本不包 bracketed paste → OS 把写入切片，Claude 生成多个 `[Pasted text #N]` | Nimbalyst `claudeCliSubmit.ts`（2 万字符 → 8 个占位符） | 正文统一包 `ESC[200~ … ESC[201~` |
| 等待时间按 JS 字符串长度算 → **中文**只等了约 1/3，回车提前到达 | Nimbalyst issue #1387 | 按 **UTF-8 字节数**计算延迟 |
| Codex 硬编码突发识别：≥3 字符、间隔 ≤8ms 即判定粘贴，之后 120ms 内 Enter 视为换行 | `codex-rs/tui/src/bottom_pane/paste_burst.rs:159-170` | 等待 > 120ms；或启动时 `-c tui.disable_paste_burst=true`（需实测） |
| `/`、`#` 开头的输入用粘贴发送 → 不会打开命令/记忆模式；无参 `/cmd` 回车会执行模糊匹配的高亮项（真实事故：`/implement` 执行成了 `/investigate`） | Nimbalyst `claudeCliSubmit.ts` | 首字符作为单独按键写入；无参 slash 命令补一个空格再回车 |
| Claude 可能把粘贴内容包进 `<pasted_content>`，模型将其视为"数据"而非"指令" | 二进制反查；Orca `pasteNeedsTypedRequest` | 短单行直接"打字"；多行时首行打字、余下粘贴（**待实测验证**） |
| 启动时目录信任弹窗吃掉首条粘贴 | Orca `claude-folder-trust-file.ts` | 启动前预写 `~/.claude.json` 的 `hasTrustDialogAccepted`（Codex 写 `trust_level`）；或首条 prompt 走 argv / 隐藏参数 `--prefill` |
| 固定 sleep 不可靠（未就绪时 prompt 丢失） | claude-squad #266 | **闭环确认**：在 xterm buffer 中看到文本/占位符再发回车（cmux 的事件队列 `waitForVisibleText`、Orca `native-chat-observed-send.ts`） |
| Claude 多行内容的提交键 | cmux `TextBoxAgentDetection.swift:82-93` 对 Claude 多行用 `ctrl+enter` | 需实测：`\r` 与 Ctrl+Enter 在 Claude 2.1.x 下的行为差异 |
| 同一 PTY 两次发送交错 | Superset `followUpWriteChain`、Orca `native-chat-pty-send-queue.ts` | 每个 PTY 一个发送队列 |
| 图片 | 各家一致 | 图片存临时文件 → 以 bracketed paste 写**路径**，两个 CLI 都自动转附件（不污染剪贴板） |
| 中文输入法回车误发 | Conductor 0.50 修复记录、opcode #19/#125 | 判断 `isComposing` / `keyCode===229` / `key==='Process'` |
| Esc 清空草稿 | Crystal #183 | 草稿按会话持久化，Esc 只作为"直通给 agent 的中断键" |

**额外好处：** xterm.js 的 IME 是重灾区（近半年新开十几个 IME issue：#6161、#6144、#6089、#5887、#6045、#6065、#6112…），而原生 composer **完全绕开了这条路径**——对中文用户是决定性的体验优势。

**终端内的补充手段**（不能替代 composer，但便宜）：键位映射 ⌘⌫→Ctrl+U、⌘←/→→Ctrl+A/E、⌥←/→→ESC b/f、Shift+Enter→换行（Emdash、Superset、Warp 都做了）。

### 2.2 需求②：外观与自定义

| 产品 | 主题 | 字体 | 中英分设 | 背景/透明 | 配置方式 |
|---|---|---|---|---|---|
| Warp | YAML，支持**渐变**、背景图（仅 JPEG）、GUI 主题生成器 | 字体/字号/字重/行高 | ✗（CJK 回退字体从服务器下载 Noto） | 透明度 + macOS 模糊 | GUI + `settings.toml` |
| Wave | JSON 主题 | 只有 fontfamily/fontsize | ✗ | **任意 CSS background**（图片/渐变/混合模式）、按标签/块设置、macOS vibrancy | 只有 JSON 编辑器 |
| cmux | Ghostty 600+ 主题、自定义 shader | Ghostty 配置 | 配置文件 `font-codepoint-map`；**自动注入 CJK 字体**引发大量 issue（#2755、#4519、#17490） | 透明、模糊、背景图、macOS 26 玻璃 | 配置文件为主 |
| Orca | ~30 内置 + Ghostty/Warp 主题导入 | 字体/字号/字重/行高/连字 | ✗ | 背景不透明度；**macOS vibrancy 被刻意移除**（每帧合成性能问题，#8482）；无背景图 | GUI |
| Superset | 6 内置 + JSON 导入 | 字体/字号/行高/字距/连字；单等宽检测 | ✗ | ✗ | GUI |
| Conductor | 9 套语法主题 | 等宽字体 | ✗ | ✗ | GUI + TOML |
| Emdash | 4 套 | 已安装字体列表 | ✗（可手写逗号列表） | ✗ | GUI |

**结论与建议：**
- **"英文字体 + 中文字体"两个独立选择器**是全行业空白，也是你的明确诉求。xterm.js 实现方式：`fontFamily: '"<英文>", "<中文>", monospace'`——WebGL 渲染器下回退链有效（`TextureAtlas.ts:536` 用完整 CSS font 串绘制字形）。限制：xterm.js 无法像 Ghostty 那样按码点区段强制映射，单元格尺寸只按主字体测量；需开 `rescaleOverlappingGlyphs: true`、行高 1.1–1.2，并在字体加载完成后 `clearTextureAtlas()`。
- **背景**：借鉴 Wave 的"直接用 CSS background 语义"（图片/渐变/混合模式/不透明度）——Web 技术栈下成本最低、表现力最强。
- **毛玻璃**：只用在侧边栏/标题栏（`vibrancy: 'sidebar'`），终端区域保持不透明或高不透明度。原因：xterm.js 6.0 透明背景有多个渲染 bug（#5558 变黑、#6116 斜体/暗淡单元格出黑块、#5847 大量流式输出残影），且 Orca 实测 vibrancy + 透明窗口有每帧合成开销。
- **实时预览的设置 GUI**（字体对比预览、主题即时切换）+ 可导入 Ghostty/iTerm 主题（Orca 有现成思路）。

### 2.3 需求③：侧边栏状态 + 快速回复

**状态检测——三种来源的可靠性排序：**

1. **Hooks（权威）**。Claude Code 事件：`UserPromptSubmit`→working、`PreToolUse/PostToolUse`→working（带 `tool_name`/`tool_input` 可显示"正在编辑 xxx"）、`PermissionRequest` / `Notification(permission_prompt|elicitation_dialog)`→等你处理、`Stop`/`StopFailure`→完成/出错、`SessionEnd`→退出。Codex 0.142 也有同名事件（外加 `Interrupt`）。
2. **OSC / 标题（便宜的兜底）**：Claude 标题工作中 `◐/◑` 交替、空闲 `✳`；Codex 标题为盲文 spinner；**Codex 主干刚合入 OSC 7501**（`state=idle|working|blocked`，0.142.5 尚未包含）。
3. **屏幕解析（最后兜底）**：ccmanager 有最完整的规则表（定位输入框边框、只看其上方、1.5s 空闲去抖），但每次 Claude 改 UI 就坏（#227、#113、#117）。必须在 xterm buffer 上匹配，不能 grep 原始字节流（ratatui 差分重绘会把 `esc to interrupt` 拆碎）。

**Hooks 注入方式——两派：**

| 方式 | 谁在用 | 评价 |
|---|---|---|
| 写入用户全局 `~/.claude/settings.json`，用环境变量门控 | Orca、Superset、Emdash | 侵入用户配置；你本机已被 Orca 写入 12 类事件 |
| PATH 上放 `claude` wrapper，每次调用 `--settings <file>` 注入 | **cmux**、**Nimbalyst** | **推荐**。官方文档确认 `--settings` 与用户 hooks **合并**。坑：命令行出现两个 `--settings` 只生效一个（且新旧版本取先/取后不同），wrapper 必须先把用户自带的 `--settings` 深合并进来 |

Codex 坑：非托管 hook 必须在 `config.toml` 有匹配的 `trusted_hash` 才执行。方案：`--dangerously-bypass-hook-trust`（cmux，有安全争议 #8136）或通过 `codex app-server` 的 `hooks/list` 取 hash 后写入信任记录（Orca）。另外**不要用 `-c notify=`**——它会整体覆盖你本机已有的 notify 配置。

**快速回复/选项点选——四种实现：**

| 方式 | 谁 | 优点 | 缺点 |
|---|---|---|---|
| **阻塞 hook 返回决策**：`PermissionRequest` hook 挂起等待 GUI，返回 `{behavior: allow/deny}`；AskUserQuestion 通过 allow + `updatedInput` 回填答案；超时返回 `{}` 回退到 TUI 原生提示 | **cmux Feed** | 结构化、不依赖按键时序、超时可自愈 | hook 挂起期间 TUI 也在显示提示，两边要同步 |
| **hook 载荷 + 向 PTY 发按键**：从 hook 的 `tool_input` 拿到选项结构，点击后发数字键（单选数字即提交；多选数字切换→`→`→Enter；"其它"= N+1 → 文本 → Enter），每组按键间隔约 500–1000ms | **Orca** | 不改变 agent 行为，TUI 始终是真相源 | 依赖按键时序；回答 AskUserQuestion 不产生 hook，需要推断"已回答" |
| **替换工具**：`--disallowedTools AskUserQuestion` + MCP 版 AskUserQuestion + `--append-system-prompt` 引导；权限用 PreToolUse hook | **Nimbalyst** | 选项以 JSON 到达，最可靠 | 改变了模型行为；注意 `--permission-prompt-tool` 在交互式 TUI 下**被静默忽略** |
| 屏幕识别 `❯ 1. … 2. …` 编号菜单 | （无主流产品做，ccmanager 只识别"在等待"） | 通用、不需要 hook | 易误判，UI 改版即坏 |

**建议**：权限确认走 cmux 式阻塞 hook（Once / Always / Deny 按钮，超时回退）；AskUserQuestion 先走 Orca 式"hook 拿结构 + 发数字键"，屏幕识别编号菜单作为未装 hook 时的兜底。**注意**：Claude AskUserQuestion 下直接 Enter 只会提交高亮的第一项，粘贴选项文字不会移动高亮（Orca STA-1860）。

**侧边栏信息设计**（综合 Vibe Kanban / Conductor / Warp / Orca）：
- 分组："需要你处理"（权限/提问/出错）→"运行中"→"已完成未读"→"空闲"。判定公式参考 Vibe Kanban：`needsAttention = pendingApproval || (unseen && !running)`。
- 每行：agent 图标 + 状态角标（Warp 的视觉语言）、任务标题（首条 prompt / AI 命名）、当前动作（"编辑 src/App.tsx"、"运行 npm test"）、分支、`+N −M`、耗时；悬浮卡片显示最近一条回复。
- **"工作中（转圈）"和"等你处理（醒目）"必须区分**（Emdash #531 教训）。
- 不切换会话即可回复（claude-squad #312 是最直接的用户需求证据）。
- 通知：仅在窗口失焦或会话不可见时发；Dock badge；可选提示音；点击直达会话。

### 2.4 需求④：Worktree 管理与合并

**最佳实践汇总：**

| 环节 | 推荐做法 | 来源 |
|---|---|---|
| 存放路径 | **仓库外**集中目录，如 `~/TerminalReborn/worktrees/<repo>/<name>`；可按项目覆盖 | Emdash、Orca、Superset、Conductor（避开 Crystal 放 `<repo>/worktrees` 被 IDE 索引的坑） |
| 创建 | `git worktree add --no-track -b <branch> <path> <base>`，创建前 `fetch`，记录 base（`git config branch.<name>.base`）作为 diff 基线 | Superset、Orca、claude-squad |
| 分支命名 | 前缀 + slug；**中文标题需兜底**（Emdash 的 sanitize 会把中文清空）；可后台 AI 改名（仅未推送时） | Superset、Orca、Conductor |
| 复制被忽略文件 | 支持 **`.worktreeinclude`**（Claude Code / Conductor / Codex / ccmanager / Orca 共用约定），用 APFS `cp -c` 写时复制 | ccmanager、Orca、Emdash |
| 生命周期脚本 | setup / run / teardown(archive)，在可见终端标签里运行；环境变量 `*_ROOT_PATH`、`*_WORKSPACE_PATH`、端口段 | Conductor、Superset、Orca（Orca 还能导入 conductor/superset/cmux 配置） |
| **本地合并** | 先检查 base 是否领先（diverged 则要求 rebase）→ `git merge-tree` **预检冲突** → 支持 merge `--no-ff` / squash / rebase + `--ff-only`；base 未 checkout 时可用 libgit2 内存合并不动工作区 | Vibe Kanban、Crystal、ccmanager |
| 冲突处理 | 检测 merge/rebase/cherry-pick/revert 进行中状态；Abort / Continue；**一键"交给 agent 解决"**（生成包含冲突类型、分支、冲突文件列表、`GIT_EDITOR=true` 提醒的 prompt） | Vibe Kanban、Crystal、Orca；Farol 有三栏冲突编辑器 |
| PR | `gh pr create/merge`，跟踪 CI | 主流都有 |
| 清理 | 合并后提示删除 worktree（保留分支）；可配置 TTL 自动回收；孤儿 worktree GC | Vibe Kanban（归档 1h/闲置 72h）、Emdash #1345、cmux #3320 |
| 轻量暂停 | 自动提交 → 移除 worktree → 保留分支 → 复制分支名 | claude-squad |

**空白**：Orca / Superset / Emdash / Conductor 都**只走 GitHub PR**，本地合并到 main 的 UI 普遍缺失（Emdash #1269、ccmanager 冲突后不 abort #59）。对"本地多线程 vibe coding"场景，**本地合并 + 冲突交给 agent** 是高价值功能。

### 2.5 需求⑤：Git 树可视化

| 产品 | 提交图 | Diff 查看器 |
|---|---|---|
| Orca | ✓ VS Code 风格 swimlane SVG（`git log --topo-order`） | Monaco DiffEditor |
| Farol | ✓ 自研 lane 算法，右键 checkout/rebase/cherry-pick/revert | 三栏冲突解决器 |
| Nimbalyst | 扩展形式的 visual git log | — |
| 其余（cmux/Superset/Emdash/Conductor/Warp/Wave/Vibe Kanban/ccmanager/claude-squad） | ✗（最多提交列表） | Superset/cmux/Vibe Kanban/Conductor 用 **@pierre/diffs**；Emdash/Crystal 用 Monaco |

**关键差异化**：没有任何产品把 **worktree HEAD + 对应 agent 状态** 标在提交图上，也没有"在图上拖拽合并"。

**实现建议：**
- **自研 lane 算法**（约 50 行，O(n·lanes)，可增量分页）+ 每行 SVG + `@tanstack/react-virtual` 虚拟化。
- **不能复用 vscode-git-graph 代码**：其 LICENSE 明确禁止发布衍生作品，只能参考算法思路；GitLens 图是 GitKraken 专有；gitgraph.js 已归档。
- worktree 标注：`git worktree list --porcelain -z`（Git ≥2.36）映射到行，显示名称、脏状态、locked/prunable，以及 agent 状态点；点击跳到对应终端。
- **Diff 查看器选 @pierre/diffs**（Apache-2.0；Superset、cmux、Vibe Kanban 已在生产验证；支持 split/unified、行内评论插槽、worker 池、虚拟化多文件）。行内评论可一键发给 agent（Emdash、cmux、Conductor 都把这当核心卖点）。需要"在 diff 中编辑"时再懒加载 Monaco 或 `@codemirror/merge`。

---

## 3. 各产品速写（值得抄 / 要避开）

**Orca**（MIT，可借鉴代码）
- 抄：IME 处理全套（`terminal-pane/terminal-ime-*.ts`：搜狗/fcitx 候选键保护、组字期间延迟 Enter）；hook 脚本的 spool 回退与端口自愈（`endpoint.env`）；AskUserQuestion 按键序列（`native-chat-ask.ts`）；提交图；`.worktreeinclude` + APFS clone；setup 脚本导入其它工具配置；状态行注入拿 rate limits；PTY 守护进程（launchd）让会话活过应用重启。
- 避：写全局 `~/.claude/settings.json`；macOS vibrancy 已被其证明有性能代价；Chat UI 仍实验性。

**cmux**（GPL-3.0，只参考思路）
- 抄：TextBox 的发送事件队列（等屏幕出现文本再下一步，不用 sleep）；Feed 阻塞 hook + 120s 超时回退；wrapper `--settings` 按次注入；状态机含 `backgroundWorkPending` 和多会话合并优先级；Agent Hibernation；diff 评审评论一键回填输入框。
- 避：只靠 hook 导致状态卡死（#1027，42 赞）——需加进程存活检测与超时自愈；SwiftUI/AppKit 混用的内存泄漏（#2962 涨到 70GB）；自动注入 CJK 字体不可覆盖；功能膨胀（"200 个设置"）。

**Superset**（ELv2，只参考思路）
- 抄：⌘I 停靠式 rich input、附件写入 worktree 后以路径发送；`sanitizePromptForPty` 清洗控制字符；WebGL 按终端回退（不全局锁定）+ 图集 32 页重置（Claude Code 真彩输出会让图集无限增长）；xterm IME 补丁（xterm PR #6162 回移）；隐藏终端"停放"+ LRU 上限。
- 避：两代架构并存的复杂度；无本地合并。

**Emdash**（Apache-2.0）
- 抄："不从终端输出推断状态"的纪律；hook 命令带版本标记与 nonce；Notification 消息按 `/permission|approval/i` 分类；`PermissionBand`（SplitButton + "1 of N" 队列）；diff 行内评论草稿。
- 避：TUI 尺寸同步问题反复出现（#2538 多选菜单乱码）——切换标签/面板后必须重新 fit + resize；tmux 包装导致闲置空白（#3109）。

**Conductor**（闭源）
- 抄：Workspace 生命周期（来源可选分支/PR/Issue → 复制文件 → setup → 端口段 → run → 审阅 → PR → 自动归档可恢复）；**Spotlight**（把某 worktree 改动单向同步到仓库根目录，复用已在跑的重型本地栈）；Checkpoints（每轮对话存私有 git ref，可回滚）；侧边栏悬浮卡片 + 跳到最早未读；steering（运行中直接插话）。
- 避：GUI 与 TUI 二选一；重度依赖 GitHub。

**Warp**（AGPL，只参考思路）
- 抄：`RichInputSubmitStrategy` 按 agent 区分提交策略；agent 需要输入时自动弹出输入框、工作时隐藏、按会话保存草稿；OSC 777 + JSON 的 agent 状态协议（环境变量广播协议版本）；竖向标签的状态角标视觉；YAML 主题支持渐变。
- 避：只识别"Blocked"不识别选项；CJK 字体从服务器下载。

**Wave**（Apache-2.0）
- 抄：背景系统（任意 CSS background、按标签/块、vibrancy）；`wsh badge` 带优先级和 pid 自动清除；平铺布局 + Magnify。
- 避：WebGL 下 CJK 宽字符错位（#3386）；设置只有 JSON 编辑器。

**Nimbalyst**（MIT，可借鉴代码）
- 抄：`claudeCliSubmit.ts` 的发送规则全集（按 UTF-8 字节计算延迟、`/`/`#` 首字符单发、无参 slash 补空格）；Ctrl-C → Ctrl-C → SIGINT 逐级中断；ghostty-web 每终端独立 WASM 实例（避免共享堆损坏）。
- 避：本地 API 代理（`ANTHROPIC_BASE_URL`）观测流量——涉及用户 OAuth 流量，若做必须显式告知并可关闭。

**Vibe Kanban / ccmanager / claude-squad**
- Vibe Kanban 抄：合并前 diverge 检查、四类冲突状态检测、"交给 agent 解决冲突"的 prompt 模板、`NormalizedEntry` 事件模型、worktree TTL 回收。避：强制云/登录、默认遥测、大改版丢数据（公司已关停）。
- ccmanager 抄：屏幕规则表（作为兜底层）、状态 hooks 用环境变量传参、`.worktreeinclude` + pre/post hooks 顺序、自动审批"确定性黑名单 + 小模型判定"。
- claude-squad：只看其 Pause 流程；其余全是反面教材。

---

## 4. 关键技术决策

### 4.1 包装真实 TUI vs headless 自绘

| | 包装真实 TUI | headless（stream-json / SDK / ACP） |
|---|---|---|
| 功能完整度 | ✅ slash 命令、Plan Mode、插件、订阅登录全都有，跟随上游自动更新 | ❌ 丢交互式能力，依赖适配器跟版本 |
| 输入体验 | 需要外置 composer 并处理时序 | ✅ 原生 |
| 结构化信息 | 需 hooks / JSONL 补充 | ✅ 天然 |
| 渲染稳定性 | 需处理尺寸同步、重绘 | ✅ 自控 DOM |
| 用户心智 | "这就是我的终端"，随时可接管 | "又一个聊天 GUI" |

**结论：以真实 TUI 为主体**（与"终端"定位一致，也是你的原始诉求），在其上叠加：原生 composer、hooks 驱动的状态与卡片、结构化镜像（可选，读 `transcript_path` JSONL）。

### 4.2 应用框架

| | Electron + xterm.js | Tauri + xterm.js | Swift + libghostty |
|---|---|---|---|
| 终端性能 | 足够（10MiB 洪泛 1.2s vs Ghostty 0.2s） | 同左 + IPC 开销 | 最好 |
| CJK/IME | Chromium 路径测试最充分；composer 兜底 | **WKWebView 特有 IME 问题集中**（#6144、#6084、#5847） | 原生最好 |
| 毛玻璃 | `vibrancy` 一行 | 需私有 API，上架风险 | 原生 |
| 包体积 | 大（Orca.app 510MB） | 小 | 小（Ghostty 62MB） |
| 开发速度 | **最快**；git 图、diff、设置页全用 React；有 Orca/Superset/Emdash/Wave 可参考 | 中 | 慢；libghostty 内部 API 无文档、需维护 fork、Zig 工具链坑 |

**建议：Electron + xterm.js 6.1 beta + node-pty（放在 utilityProcess 或独立守护进程）+ React。** 终端层抽象为 `TerminalSurface` 接口（write / onData / buffer / OSC），为将来换成 libghostty（Electron ≥41 `sharedTexture` 已有零拷贝原型）留出口。只有当"极致原生性能"成为第一卖点时才考虑 Swift + libghostty（参考 cmux 的混合做法：终端原生、diff/git 图用 WKWebView + React）。

**xterm.js 配置要点**：WebGL 渲染（失败按终端回退 DOM、不全局锁定）、unicode11、`rescaleOverlappingGlyphs`、字体预加载、图集定期重置、kitty 键盘协议**保持关闭**（#6112 会丢中文单字提交）、切换标签/面板后强制 fit + resize（Emdash #2538）。

---

## 5. TerminalReborn 的差异化定位与功能建议

**一句话定位**：*唯一同时提供"原生 TUI + 常驻桌面级输入框 + 侧边栏点选回复 + 本地 worktree 合并 + 带 agent 状态的 git 树"，并且对中文用户友好、可深度美化的 agent 终端。*

**建议分期（仅供讨论，待你确认后再细化）：**

**P0 · 第一版（验证核心体验）**
1. 终端内核：Electron + xterm.js（WebGL）+ node-pty；多会话；macOS 键位映射。
2. 常驻 composer：原生多行编辑、IME 安全、按会话草稿、图片/文件拖入、发送协议（§2.1）、空输入时 Esc/↑↓/Shift+Tab 直通 agent。
3. 状态：`claude` / `codex` wrapper + `--settings` hooks + OSC/标题兜底；侧边栏分组 + 当前动作 + 系统通知 + Dock badge。
4. 外观：主题预设、**英文/中文字体独立选择**、字号行高、背景（纯色/渐变/图片）、侧栏毛玻璃、设置实时预览。

**P1 · 第二版（多线程开发）**
5. 快速回复：权限卡片（阻塞 hook）、AskUserQuestion 选项按钮、侧边栏内联回复框。
6. Worktree：新建任务（分支 + worktree + 启动 agent + 首条 prompt）、`.worktreeinclude`、setup 脚本、本地合并（预检 + merge/squash/rebase）、冲突交给 agent、合并后清理。
7. Diff 审阅：@pierre/diffs、行内评论发给 agent。

**P2 · 第三版（可视化与深化）**
8. Git 树：自研 lane 图 + worktree/agent 状态标注 + 右键操作。
9. 会话持久化（PTY 守护进程、`claude --resume`）、checkpoint、Spotlight、总览网格视图。

---

## 6. 风险与待验证项

1. **Composer 发送协议需在本机实测**：Claude 2.1.289 下 `\r` vs Ctrl+Enter、`<pasted_content>` 对指令遵循的实际影响、Codex `disable_paste_burst` 的副作用。
2. **Hooks 注入**：`--settings` 双参数冲突的当前版本行为；与本机 Orca 全局 hooks 并存时是否重复上报（Orca 的脚本在无 `ORCA_*` 环境变量时会 spool 到文件，不影响功能但有磁盘写入）。
3. **Codex hook 信任**：选 `--dangerously-bypass-hook-trust`（简单但全局跳过信任）还是写 `trusted_hash`（复杂但安全）。
4. **状态卡死**：hook 丢事件时的超时自愈策略（cmux #1027 的教训）。
5. **xterm.js 透明背景 bug**：若坚持终端区透明，需跟踪 #6116、#5847。
6. **许可证**：可借鉴代码的仅 MIT/Apache（Orca、Nimbalyst、Emdash、Wave、Crystal、ccmanager、Vibe Kanban、Farol、Calyx）；cmux（GPL）、Warp/claude-squad/opcode（AGPL）、Superset（ELv2）、vscode-git-graph（禁止衍生）只能参考设计。

---

## 附录 A：关键源码索引

本地克隆位置：`/private/tmp/claude-501/-Users-m-Desktop-TerminalReborn/b08ba8db-67a7-4755-8bfc-2399288fa912/scratchpad/repos/`（临时目录，会话结束可能被清理）

| 主题 | 文件 |
|---|---|
| PTY 发送协议 | `nimbalyst/packages/electron/src/main/services/ai/claudeCliSubmit.ts`；`orca/src/shared/agent-prompt-injection.ts`；`superset/packages/host-service/src/terminal/terminal.ts`（~L499、L1226）；`cmux/Sources/TextBoxInput.swift`（L1213、L1603） |
| Codex 突发识别 | `codex/codex-rs/tui/src/bottom_pane/paste_burst.rs:159` |
| 选项按键序列 | `orca/src/shared/native-chat-ask.ts:200-329`；`orca/src/shared/native-chat-answer-stepping.ts` |
| 阻塞 hook 快速回复 | `cmux/docs/feed.md`；`cmux/Sources/Feed/`；`cmux/Resources/bin/cmux-claude-wrapper` |
| `--settings` 注入 | `cmux/CLI/CMUXCLI+ClaudeHookSettings.swift`；`nimbalyst/.../claudeCliPermissionHookConfig.ts` |
| 屏幕状态规则 | `ccmanager/src/services/stateDetector/{claude,codex}.ts`；`orca/src/main/runtime/agent-state-rules/*.json` |
| IME | `orca/src/renderer/src/components/terminal-pane/terminal-ime-*.ts`；`superset/patches/README.md` |
| 字体回退 | `xterm.js/addons/addon-webgl/src/TextureAtlas.ts:536`；`cmux/Sources/GhosttyTerminalView.swift:1398` |
| 背景系统 | `waveterm/frontend/util/waveutil.ts`（`computeBgStyleFromMeta`）；`warp/crates/warp_core/src/ui/theme/mod.rs` |
| Worktree 合并/冲突 | `vibe-kanban/crates/git/src/{lib.rs:575,cli.rs:527}`；`crystal/main/src/services/worktreeManager.ts:340,557`；`vibe-kanban/packages/web-core/src/shared/lib/conflicts.ts` |
| `.worktreeinclude` | `ccmanager/src/utils/worktreeInclude.ts`；`orca/src/main/git/worktree-include-file.ts` |
| 提交图 | `orca/src/shared/git-history-graph.ts`；`farol/Sources/FarolCore/History.swift` |
| worktree 解析 | `orca/src/shared/git-worktree-porcelain-parser.ts` |
| Diff | `superset/.../DiffPane/DiffPane.tsx`（@pierre/diffs）；`emdash/.../diff-view/comments/monaco-comment-manager.ts` |

## 附录 B：主要参考链接

- Claude Code：[hooks](https://code.claude.com/docs/en/hooks) · [settings](https://code.claude.com/docs/en/settings) · [interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Codex：[hooks](https://developers.openai.com/codex/hooks) · [OSC 7501 PR #52725](https://github.com/openai/codex/pull/52725) · [#28167](https://github.com/openai/codex/issues/28167)
- 产品：[Orca](https://github.com/stablyai/orca) · [cmux](https://github.com/manaflow-ai/cmux) · [Superset](https://github.com/superset-sh/superset) · [Emdash](https://github.com/generalaction/emdash) · [Conductor docs](https://www.conductor.build/docs) · [Warp](https://github.com/warpdotdev/warp) · [Wave](https://github.com/wavetermdev/waveterm) · [Nimbalyst](https://github.com/nimbalyst/nimbalyst) · [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) · [ccmanager](https://github.com/kbwo/ccmanager) · [claude-squad](https://github.com/smtg-ai/claude-squad) · [Farol](https://github.com/snowztech/farol) · [Calyx](https://github.com/yuuichieguchi/Calyx) · [awesome-libghostty](https://github.com/Uzaaft/awesome-libghostty)
- 技术：[xterm.js 6.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0) · [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs) · [commit graph 算法](https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html) · [ghostty-xterm-bench](https://github.com/mxschmitt/ghostty-xterm-bench)
