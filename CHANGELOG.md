# Changelog

All notable changes to Wavi (named Terminal Reborn until v0.1.1). Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-10-25

Change the terminal's background, and import a Ghostty or iTerm theme.
终端底色可以改了，也能导入 Ghostty 和 iTerm 的主题。

### Appearance / 外观
- 设置 · 外观 · 窗口 has 终端底色 (跟随主题 / 自定义) and 底色值: click the swatch for the system color picker, or type or paste a hex. While the terminal follows the theme, the value is dimmed and shows the color in effect; the last custom color is remembered. The text and ANSI colors follow the background's lightness, so a light background under the dark theme still reads. Gradients and images are still not offered.
  设置 · 外观 · 窗口多了“终端底色”（跟随主题 / 自定义）和“底色值”：点色块打开系统取色器，也可以直接输入或粘贴十六进制。跟随主题时底色值置灰并显示当前实际的颜色，自定义过的颜色会记着。文字和 16 色按底色的明暗选，所以深色主题下用浅色底也看得清。仍然不提供渐变和图片背景。
- 导入主题… (under the theme swatches) reads a Ghostty theme file or an iTerm `.itermcolors` preset. Its background, foreground, cursor, selection and 16 ANSI colors are used as they are, so the terminal shows exactly the colors you imported. A file that is not a theme, or lacks a color, is refused with a reason and nothing changes. 恢复默认 clears the imported colors.
  主题色块下方的“导入主题…”读 Ghostty 主题文件或 iTerm 的 `.itermcolors`。它的背景、前景、光标、选区和 16 色原样用于终端，导入的是什么颜色，终端里看到的就是什么颜色。不是主题的文件、或缺少某个颜色的文件会被拒绝并说明原因，设置不变；“恢复默认”会清掉导入的颜色。

## [0.7.0] - 2026-10-25

Start 19 agent CLIs natively, put a PR together from one sheet, run the same task several ways, and read each session's agent and branch in the sidebar.
原生启动 19 家 agent CLI，一个面板完成提交、推送和 PR，同一个任务开几份比较，侧栏直接看到每个会话是哪家 agent、哪个分支。

### Agents / 智能体
- 新建会话 now picks from a menu of the CLIs installed on your Mac: Claude Code, Codex, OpenCode, Gemini CLI, Qwen Code, Pi, Copilot, Cursor, Grok, Kimi, Droid, Amp, Kiro, Crush, Goose, Cline, Antigravity, Auggie and CodeBuddy, or a plain terminal. Each starts in its worktree, can be resumed, and takes a first message.
  新建会话改为下拉菜单，列出本机装了的 CLI：Claude Code、Codex、OpenCode、Gemini CLI、Qwen Code、Pi、Copilot、Cursor、Grok、Kimi、Droid、Amp、Kiro、Crush、Goose、Cline、Antigravity、Auggie、CodeBuddy，或普通终端；每个都在自己的 worktree 里启动、能续上、能带首条消息。
- Status is exact where the CLI allows it (per-launch hooks for Gemini, Qwen and Pi; the terminal's program-status protocol for OpenCode, Grok, Crush, Goose and Pi 1.1+) and estimated from the title otherwise. 设置 · 智能体 lists each CLI with its version, whether its status is exact or estimated, and the install command for the ones you lack. Wavi never touches their global config.
  能准确的就准确（Gemini、Qwen、Pi 每次启动注入 hooks；OpenCode、Grok、Crush、Goose、Pi 1.1+ 走终端状态协议），其余看标题估计。设置 · 智能体列出每家的版本、状态是准确还是估计，以及没装的安装命令；不改它们的全局配置。
- The sidebar shows each session's agent with its own logo, and the worktree's branch, on the row's last line.
  侧栏每个会话的最后一行写这个会话跑的 agent（用它自己的图标）和 worktree 的分支。

### Same task, several ways / 同任务多解
- From a conversation, “同任务多解…” (⇧⌘N, also in the session menu, ⌘K and the terminal's right-click menu) opens 2–4 new worktrees off its branch, each with an agent you pick and the task you chose: the text you selected, the agent's plan, or what you said in that session. The session itself is not one of them.
  从对话里发起：“同任务多解…”（⇧⌘N，也在会话菜单、⌘K 和终端右键菜单里）在它的分支上开 2–4 个新 worktree，各跑你选的 agent，任务是你选中的文字、agent 的计划或你在这个会话里说过的话；原会话不算一份。
- When they have all stopped, the original session gets one report with every branch, diff size and check result, to compare and recommend; merging stays yours. If it cannot be delivered it waits under the terminal for 送进去.
  几份都停下后，原会话收到一份汇报（每份的分支、改动量和检查结果），用来比较和推荐，合并仍由你做；送不进去时留在终端下方等你点“送进去”。

### Pull requests / PR
- The PR button follows the worktree's git state (提交并创建 PR, 创建 PR, 提交并推送, 推送到 PR #N, 打开 PR #N). The sheet gains a 提交 section: tick files, edit the message, then commit, push and create run in order, each step with its progress and the git hook's output if it fails.
  PR 按钮按 worktree 的 git 状态换文字。面板多一段“提交”：勾文件、改提交说明，然后按提交、推送、创建的顺序做，每一步写明进度，失败时显示 git hook 的输出。
- AI 写 fills the commit message and PR text from your own Claude or Codex login (Haiku by default); you read it before using it. Model and “write on open” live in 设置 · 自动化 · PR, both off by default.
  “AI 写”用你本机 Claude 或 Codex 的登录写提交说明和 PR 标题正文，你看过再用；模型和“打开面板时自动写”在设置 · 自动化 · PR，默认关。

### Interface / 界面
- The context popover shows only the figure and its bar; the usage popover only each vendor's windows (name, %, reset, bar). Captions, the trend line, pace sentences and the per-session shares are gone.
  context 浮层只留数字和条，额度浮层只留每个厂商的窗口（名称、百分比、重置时间、条）；说明文字、趋势线、速度预测和各会话份额都去掉了。
- 设置 no longer draws dividers or outlines on rows, navigation, inputs and buttons.
  设置去掉了行、导航、输入框和按钮上的所有分隔线和描边。
- The README is English first, with real screenshots; the Chinese one is README.zh-CN.md.
  README 改为英文在前、配真实截图，中文在 README.zh-CN.md。

### Fixed / 修复
- Opening a file from a terminal link before the 文件 view had been shown left its tree empty; it now lists the root.
  先点终端里的文件路径、再打开文件视图时文件树是空的，现在会列出根目录。
- Where two split hairlines cross, the outer split's line is now the one you grab.
  分屏里两条分隔线交叉处，现在抓到的是外层那条。

## [0.6.0] - 2026-10-22

Let agents hand work to each other, and take a PR from review to merge without leaving Wavi.
让 agent 之间互相派活，并在 Wavi 里把 PR 从审阅一路做到合并。

### Dispatch / 派活与回报
- An agent can start new Claude Code or Codex sessions, each in its own worktree with its own task, in any direction (Claude to Codex, Codex to Claude, or the same kind), and gets their results back when they finish. Wavi gives every agent its tools at launch; nothing is written to your global agent config.
  agent 可以开新的 Claude Code 或 Codex 会话，每个都在自己的 worktree 里、带着自己的任务，方向不限（Claude 派给 Codex、Codex 派给 Claude、同一家互派），做完后结果自动回到派活的会话。工具在启动时注入，不写你的全局 agent 配置。
- Every batch waits for you: a panel says how many sessions, which agent, what task and who gets the results (设置 · 自动化 · 派活 can skip it). At most four open sessions per dispatcher, and dispatched sessions cannot dispatch further.
  每一批都先等你确认：面板写明开几个、什么 agent、发什么任务、结果报告给谁（设置 · 自动化 · 派活里可以免确认）。一个派活方同时最多 4 个，被派出的会话不能再往下派。
- Results reach the dispatcher through Claude's cross-session inbox or `codex queue`, never typed into its terminal; anything that cannot be delivered waits under it for 送进去. Dispatched sessions sit under their dispatcher in the sidebar, their header says 由「…」派出, and the overview lists them together.
  结果经 Claude 的跨会话收件箱或 `codex queue` 送到派活方，从不往它的终端里打字；送不进去的留在它下方等你点“送进去”。侧栏里子会话排在派活会话下面，会话头写“由「…」派出”，总览里把它们列在一起。

### Pull requests / PR
- 创建 PR opens a sheet with the title, a body from the repository's PR template or the commits, and this turn's checks and review as evidence; it can review before pushing.
  “创建 PR”打开面板：标题、按仓库 PR 模板或提交说明生成的正文，以及这一轮的检查和审阅作为证据；可以推送前先审阅。
- Unresolved PR threads and comments come back into Git · 变更 next to the lines they are about; tick them to send to the agent, mark them resolved, or post Wavi's review to the PR as a comment.
  PR 上没解决的讨论和评论回到 Git · 变更，挂在对应的行上；勾选后发给 agent、标记已解决，或把 Wavi 的审阅作为评论发到 PR。
- Merge a GitHub PR from the merge sheet: only the methods the repository allows, always pinned to the head you reviewed, with GitHub auto-merge, the merge queue or Wavi waiting for checks. Afterwards Wavi pulls the base and offers to archive the worktree.
  在合并面板里合并 GitHub PR：只列仓库允许的方式，总是锁定你审阅过的那个提交，可选 GitHub 自动合并、合并队列或由 Wavi 等检查通过。合并后拉取基线，并可归档 worktree。
- Two switches per PR, off by default: 自动修复 sends failing checks and new comments to the agent (at most 3 times), 通过后合并 merges once everything is green.
  每个 PR 两个开关，默认关：“自动修复”把失败的检查和新评论发给 agent（最多 3 次），“通过后合并”在全部通过后合并。

### Review / 审阅
- Review results are kept per worktree, so a restart does not review the same diff again, and findings you dismissed stay dismissed. Optionally the other vendor reviews (Codex reviews Claude's work and the other way round).
  审阅结果按 worktree 保存，重启后同一份 diff 不再重审，你忽略过的发现不再出现。可选由另一家来审（Codex 审 Claude 写的，反之亦然）。

### Fixed / 修复
- A branch whose upstream was `origin/main` could be pushed straight to main when creating a PR; it now always gets its own branch.
  上游指向 `origin/main` 的分支在创建 PR 时可能被直接推到 main；现在总是推到自己的分支。
- CI logs sent to the agent no longer carry escape codes, outdated threads can be resolved too, and the base catches up after GitHub merges a PR.
  发给 agent 的 CI 日志不再带转义字符，过时的讨论也能标记已解决，GitHub 合并 PR 后基线会跟上。

## [0.5.0] - 2026-10-21

Digest the work of many agents: what they checked, where they collide, one task to several agents, and a window per project.
消化多个 agent 的产出：跑过哪些检查、哪里会冲突、一个任务交给几个 agent，以及每个项目一个窗口。

### Review and merge / 审阅与合并
- The overview's 待审阅 rows and the merge sheet show which tests, lint and type checks the agent ran this turn and whether they passed (`测试 ✓ · lint ✗ · 类型 未跑`). Read locally from the agent's hooks, no tokens spent.
  总览的“待审阅”行和合并面板显示 agent 这一轮跑过哪些测试、lint、类型检查，以及是否通过（`测试 ✓ · lint ✗ · 类型 未跑`）。在本地从 hook 读出，不花 token。
- Conflict radar: in the background Wavi checks a repo's active worktrees against each other and against the base (`git merge-tree`, your worktrees are never touched) and marks 和 xxx 会冲突 / main 已前进 · 落后 N in the overview and the Worktree view; 让 agent rebase puts the steps into the agent's input line for you to send. Needs git 2.38 or later.
  冲突雷达：Wavi 在后台把同一仓库里活跃的 worktree 两两比对、并和基线比对（`git merge-tree`，不碰你的 worktree），在总览和 Worktree 视图标出“和 xxx 会冲突”“main 已前进 · 落后 N”；“让 agent rebase”把步骤放进 agent 的输入行，由你发送。需要 git 2.38 或更新。
- 一题多解: choose 多个 in the new-session sheet (⌘N), pick 2–4 Claude Code / Codex copies and write one task. Each copy gets its own worktree from the same base and the same task; compare them side by side in the overview, merge one, and archive the rest after you confirm.
  一题多解：在新建会话面板（⌘N）里选“多个”，定 2–4 份 Claude Code / Codex，写一段任务。每份在同一个基线上有自己的 worktree、收到同一段任务；在总览里并排比较，合并其中一份，确认后归档其余的。
- Batch actions in the overview: ⌘- or ⇧-click to select sessions, then send them the same message, stop or close them. Each asks first and lists what goes to whom.
  总览批量操作：按住 ⌘ 或 ⇧ 点击多选会话，然后发送同一条消息、停止或关闭。每样都先确认，并列出发什么、发给谁。

### Windows / 多窗口
- Drag a pane, or a session in the sidebar, out of the window to give it a window of its own; open a project in its own window from the project menu or with ⇧⌘O. Windows and their layouts come back after a restart, and closing a secondary window never stops an agent.
  把一格、或侧栏里的会话拖到窗口外，它就有了自己的窗口；在项目菜单或用 ⇧⌘O 把项目开在新窗口里。重启后窗口和布局都会恢复，关掉副窗口不会停掉 agent。

### Files / 文件
- The file preview wraps long lines and renders Markdown (a button shows the source); links open in the built-in browser or in the preview.
  文件预览的长行自动换行，Markdown 直接渲染（有按钮切回源码）；链接在内置浏览器或预览里打开。

### Fixed / 修复
- Status: two dialogs waiting at once no longer clear each other, subagents and background agents no longer start or end the main turn, and a wrong status corrects itself within seconds.
  状态：同时等着的两个对话框不再互相清掉；子 agent 和后台 agent 不再开始或结束主会话的这一轮；状态错了几秒内自己纠正。
- Typing no longer stalls with many sessions printing in the background: hidden terminals stopped redrawing every frame.
  很多会话在后台输出时打字不再卡顿：看不见的终端不再每帧整屏重画。
- When a tool stopped a process tree that Wavi was part of (for example a dev task stopped by another app), the background daemon ended every running agent. Now only a real logout or shutdown ends them.
  某个工具停掉包含 Wavi 的进程树时（例如另一个应用停掉了开发任务），后台守护进程会结束所有正在运行的 agent。现在只有真正的注销或关机才会结束它们。

## [0.4.0] - 2026-10-20

Keep several agents in view, and take their work all the way to a PR.
同时看住几个 agent，并把它们的改动一路送到 PR。

### Several sessions at once / 同时看几个会话
- Drag a session from the sidebar into the terminal area to show two to four sessions side by side. ⌘D / ⇧⌘D split, ⌥⌘ arrows move between panes, ⌥⌘W closes a pane; the layout comes back after a restart.
  从侧栏把会话拖进终端区域，最多 4 个并排。⌘D / ⇧⌘D 拆分，⌥⌘方向键在格之间移动，⌥⌘W 关掉一格；重启后布局还在。
- The overview board's overlay tiles up to four sessions: drag a window to swap or move it, drag the gaps and edges to resize.
  总览看板的浮层最多并排 4 个会话：拖窗口换位置，拖空隙和边缘调大小。

### Pull requests / PR
- With your own `gh` login, the sidebar and the overview show each session's PR and checks (`#123 ✓`). No OAuth, no stored token.
  用你自己的 `gh` 登录，侧栏和总览显示每个会话的 PR 和 checks（`#123 ✓`）。不做 OAuth，不存 token。
- 创建 PR pushes the branch and opens the PR; when checks fail, 让 agent 修复 puts the failure and the log tail into the agent's input line for you to send.
  “创建 PR”推送分支并开 PR；checks 失败时，“让 agent 修复”把失败项和日志末尾放进 agent 的输入行，由你发送。

### Files, images and plan limits / 文件、图片与额度
- Drag files or folders onto a session, paste a screenshot with ⌘V, or pick files with the paperclip: their paths go into the agent's input line.
  把文件或文件夹拖到会话上、⌘V 粘贴截图，或用回形针选文件：路径放进 agent 的输入行。
- When a session stops because the plan limit ran out, it shows when the limit resets and can send “继续” then, only if you ask it to.
  会话因套餐额度用完停下时，显示何时恢复；你点了才会在恢复后发送“继续”。
- Plan usage is asked from your Claude and Codex accounts directly, including per-model weekly limits; context is measured against the agent's own auto-compaction point.
  额度改为直接问你的 Claude 和 Codex 账号，含按模型的周额度；context 按 agent 自己的自动压缩点计算。
- Sessions on a third-party endpoint (CC Switch, Bedrock, Vertex, a non-OpenAI Codex provider) no longer show the official account's usage.
  走第三方端点的会话（CC Switch、Bedrock、Vertex、Codex 的非 OpenAI 服务商）不再显示官方账号的额度。

### Layout / 界面
- A rounded main surface, a sidebar you can drag wider (200–480, double-click to reset), and the right panel floating on the main surface. New orbit logo.
  主界面圆角，侧栏可拖宽（200–480，双击恢复），右侧栏浮在主界面上。新的轨道 logo。

### Fixed / 修复
- Chinese input: full-width punctuation stays full-width, no double-space period, Enter / Esc while composing no longer trigger app shortcuts; links and file paths end at Chinese text.
  中文输入：全角标点不再变半角、不再双空格变句号，组合输入中按 Enter / Esc 不再触发应用快捷键；链接和文件路径在中文处结束。
- Overlapping or wrong Chinese characters with many sessions on the WebGL renderer.
  多个会话下 WebGL 渲染中文叠字、错字。
- Agents kept running across ⌘Q no longer show as idle after a relaunch; a real ⌘F never opens find behind a dialog.
  ⌘Q 后重开，后台继续运行的 agent 不再显示为空闲；弹窗里按 ⌘F 不再在背后打开查找。
- Wavi never types into a menu that is open in the agent's TUI, and tells you when it held back.
  agent 界面里有菜单开着时，Wavi 不往里打字，并告诉你为什么没放进去。

### Changed / 变更
- Release builds are signed with a Developer ID and notarized by Apple: a downloaded Wavi opens without `xattr -cr`.
  发布版改用 Developer ID 签名并经 Apple 公证，下载后直接打开，不再需要 `xattr -cr`。

## [0.3.0] - 2026-10-19

Worktrees, review and a view over every agent. There is no separate 0.2.0: its work ships here.
Worktree、审阅和所有 agent 的总览。没有单独的 0.2.0，它的内容都在这一版里。

### Renamed to Wavi / 改名为 Wavi
- The app is now **Wavi** (bundle id `dev.wavi.app`). Your Terminal Reborn workspace and settings move over on the first launch.
  应用改名为 **Wavi**。旧的工作区和设置会在第一次启动时自动迁移。

### The terminal is the whole interface / 终端就是全部界面
- The input bar and the in-app answer bar are gone: you type straight into the agent's own TUI and answer its prompts there; Wavi only marks the session 等你处理.
  去掉输入栏和应用内作答条：直接在 agent 自己的界面里输入、作答，Wavi 只把会话标成“等你处理”。
- Terminal: ⌘F search, ⌘A / ⌘C / ⌘V with Chinese text, ⌥-drag to select while an agent captures the mouse, screen-reader mode, colors that follow the light / dark theme.
  终端：⌘F 搜索、⌘A / ⌘C / ⌘V（含中文）、agent 开启鼠标上报时按住 ⌥ 拖动选中、读屏模式、底色跟随浅色 / 深色。

### Agents keep running / agent 持续运行
- Quitting with ⌘Q leaves agents running; the next launch reattaches to the same processes and catches up on what happened meanwhile. ⌥⌘Q quits and ends them.
  ⌘Q 退出后 agent 继续运行，下次打开接回同一个进程并补上期间发生的事；⌥⌘Q 退出并结束所有会话。

### Sidebar and overview / 侧栏与总览
- The sidebar groups sessions under collapsible projects, shows each session's last reply and a time that fits its state (本轮用时 · 已等 3m · 5m 前), and ⌘1–⌘9.
  侧栏按项目分组、可折叠；每个会话显示最后一句回复和随状态变化的时间；⌘1–⌘9 切换。
- Session titles come from the agent's own name for the conversation; rename by double-clicking the title.
  会话标题用 agent 自己起的名字；双击标题可重命名。
- Overview (⇧⌘A): a list that opens a session's terminal in place, and a board of status cards with a session overlay.
  总览（⇧⌘A）：列表里原地展开终端，看板用状态色块卡片并可打开会话浮层。
- Notifications name the project and session and say what the agent asked or answered; finishes within a second are merged. 等你处理 is now magenta.
  通知写明“项目 · 会话”和问题或最后一句回复，一秒内的多个完成合并成一条；“等你处理”改用品红。
- A new welcome page, and ⌘B / ⇧⌘B for the left / right panels.
  新的欢迎页；⌘B / ⇧⌘B 切换左 / 右侧栏。

### Worktrees / Worktree
- ⌘N opens a new-session sheet: a new worktree or the current folder, the base branch, the agent; the worktree is created in the background and copies ignored files listed in `.worktreeinclude`.
  ⌘N 打开新建会话面板：新 worktree 或当前目录、基于哪个分支、用哪个 agent；worktree 在后台创建，并按 `.worktreeinclude` 复制被忽略的文件。
- `.tr/settings.toml` scripts (setup / run / archive / test) run after you approve them; every worktree gets its own `TR_PORT` block and a Run button.
  `.tr/settings.toml` 的 setup / run / archive / test 脚本经你确认后运行；每个工作目录有自己的 `TR_PORT` 端口段和 Run 按钮。
- Merge sheet (⇧⌘M): checks ahead / behind, conflicts and uncommitted work, then squash, merge or rebase without leaving a half-done state; conflicts can be handed to the agent.
  合并面板（⇧⌘M）：先检查领先 / 落后、冲突和未提交改动，再 squash / merge / rebase，失败不留半截；冲突可以交给 agent 处理。
- Archive a worktree and bring it back later from ⌘K 历史.
  可以归档 worktree，之后在 ⌘K“历史”里恢复。

### Right panel / 右侧栏
- Browser per worktree (terminal links open there, sign-in pop-ups work), Git graph and changes with unified or side-by-side diffs, a Worktree list and a file tree.
  每个 worktree 一个内置浏览器（终端里的链接在这里打开，支持登录弹窗）；Git 图谱与变更（统一或并排 diff）；Worktree 列表；文件树。
- Comment on diff lines and send them to the agent; a background reviewer can turn its findings into such comments (设置 · 自动化, off by default).
  可以在 diff 行上评论并发给 agent；后台审阅能把发现的问题变成评论（设置 · 自动化，默认关）。
- Ports a session listens on show up in the sidebar and the overview.
  会话监听的端口显示在侧栏和总览里。

### Context, todo and plan usage / 上下文、todo 与额度
- Each session header shows the agent's todo progress, how full its context window is and its vendor's plan usage. Click for the details: the context curve over recent turns with compactions, cache and cost figures, each plan window's pace and when it would run out at this rate, and which sessions used it.
  会话头显示 todo 进度、上下文占用和该厂商的额度。点开看详情：最近几轮的 context 曲线和压缩点、缓存与折算成本、每个额度窗口的进度和按当前速度何时用完、各会话用了多少。
- A system notification at 75 %, 90 % and when a plan window is used up (设置 · 自动化 · 额度提醒).
  额度用到 75%、90% 和用完时各提醒一次（设置 · 自动化 · 额度提醒）。
- This also works for a `claude` or `codex` you type yourself in a plain Wavi terminal. Nothing in your global Claude or Codex config is changed.
  在普通终端里自己敲的 `claude` / `codex` 也一样；不会改动你的 Claude / Codex 全局配置。

### Known limitations / 已知限制
- Still unsigned (ad-hoc): after downloading, run `xattr -cr /Applications/Wavi.app` once.
  仍未签名（ad-hoc）：下载后需要运行一次 `xattr -cr /Applications/Wavi.app`。
- Plan usage appears after the agent's first reply; Codex plan figures on a real ChatGPT account have not been verified yet.
  额度要等 agent 第一次回复后才出现；Codex 在真实 ChatGPT 账号下的额度数据还没有验证过。

## [0.1.1] - 2026-10-15

Reliability release: agents no longer get lost to a click, a restart or a crash.
可靠性版本：agent 不会再因为误点、重启或崩溃而丢失。

### Sessions survive / 会话不再轻易丢失
- Closing the window only hides it; agents keep running. ⌘Q asks first when sessions are running or waiting for you.
  关闭窗口只是隐藏，agent 继续运行；有运行中或等你处理的会话时，⌘Q 会先确认。
- After a restart, a Claude Code / Codex session resumes its previous conversation (`--resume`) the first time you open it.
  重启后第一次打开会话时，用 `--resume` 接上原来的对话。
- Closing a running session (now also ⌘W) or removing a project with running sessions asks first.
  关闭运行中的会话（新增 ⌘W）或移除有运行中会话的项目前会确认。
- If the terminal engine crashes it restarts automatically, and affected sessions offer 全部恢复.
  终端进程崩溃后自动重启，受影响的会话可一键全部恢复。
- Workspace, drafts and window position are saved by the app itself (migrated automatically).
  工作区、草稿和窗口位置改由应用自己保存（自动迁移）。

### Honest status / 状态更准确
- New session states: 正在启动 / 未启动 · 点击恢复 / 等你确认：信任此文件夹 / 已退出, with cards that say what to do.
  新增启动中、未启动、被首次弹窗挡住、已退出等状态，并给出下一步操作。
- The composer is disabled when no agent is running, so text is never run as a shell command.
  没有 agent 运行时输入栏停用，文字不会被当作 shell 命令执行。
- `/clear` no longer freezes a session as 已退出; interrupted turns return to 空闲 within seconds.
  `/clear` 后状态不再卡死；被中断的回合几秒内回到空闲。
- Missing `claude` / `codex` command or a deleted project folder is reported with a hint instead of failing silently.
  找不到 `claude` / `codex` 命令或项目目录被删除时会明确提示。
- Hooks self-heal; when they are unavailable the header says status follows the terminal title.
  hooks 会自愈；不可用时标题栏会提示状态仅按终端标题判断。

### Also / 其他
- Settings is a dialog in the main window; the sidebar opens projects (⌘O) and starts sessions from each project; the composer and prompt bar are floating cards.
  设置改为主窗口内弹窗；侧栏可直接打开项目（⌘O）并在项目里新建会话；输入栏和选项条改为悬浮卡片。
- Packaged builds no longer include Reload / Developer Tools.
  正式版去掉了“重新加载 / 开发者工具”。

## [0.1.0] - 2026-10-14

First public release. Unsigned (ad-hoc signature): see the README for the one-time `xattr -cr`.
首个公开版本。仅 ad-hoc 签名，首次打开前请按 README 运行一次 `xattr -cr`。

### Terminal / 终端
- Real PTY terminals (xterm.js + node-pty in a utility process), many sessions in parallel, each agent keeps its native TUI.
  真实 PTY 终端，多会话并行，agent 保留原生 TUI。
- Projects and sessions with a status sidebar; Claude Code and Codex launch per session.
  项目与会话侧栏；每个会话可启动 Claude Code 或 Codex。

### Composer / 输入栏
- A real text editor for prompts: select and delete, IME-safe for Chinese input, drafts saved per session, image attachments.
  真正的输入栏：可选中删除、中文输入法安全、按会话保存草稿、支持图片附件。
- Measured send protocol (queue while the agent is busy, multi-line paste, first-run dialog guard).
  按实测制定的发送协议（agent 忙时排队、多行粘贴、首次对话框保护）。

### Status and instant replies / 状态与即时回复
- Live per-session status (working, waiting for you, done) from per-launch Claude hooks; system notifications and Dock badge.
  基于每次启动注入的 Claude hooks 显示实时状态；系统通知和 Dock 角标。
- Permission requests and AskUserQuestion answered with one click or the number keys, right above the composer.
  权限确认和选项问题在输入栏上方一键或数字键作答。
- Command palette on ⌘K with CJK-aware search.
  ⌘K 命令面板，支持中日韩文字模糊搜索。
- Hooks never touch `~/.claude/settings.json` or `~/.codex`.
  不会修改全局 agent 配置。

### Appearance and Codex / 外观与 Codex
- Settings window (⌘,): separate Latin and CJK fonts, size, line height, ligatures, solid / gradient / image background, sidebar vibrancy, light and dark themes, live preview. Changes apply to running terminals immediately.
  设置窗口（⌘,）：中英文字体分别设置、字号、行高、连字、纯色 / 渐变 / 图片背景、侧栏毛玻璃、浅色/深色主题、实时预览；修改立即应用到正在运行的终端。
- Codex sessions get live status and app-side approvals through per-launch hooks (trust pinned per launch, nothing written to `~/.codex`). Ctrl+C from an empty composer no longer quits an idle Codex. Verified with Codex 0.142.5 against a local mock model; real-model behaviour is still being validated.
  Codex 会话同样有实时状态和应用内的权限确认（每次启动注入 hooks，按次固定信任，不写 `~/.codex`）；输入栏为空时按 Ctrl+C 不会再让空闲的 Codex 退出。已在 Codex 0.142.5 + 本地模拟模型上验证，真实模型下的表现仍在验证中。

### Known limitations / 已知限制
- Not notarized: run `xattr -cr` once after download (see README). Worktree management and the git graph are planned for later releases.
  未经 Apple 公证，下载后需运行一次 `xattr -cr`。Worktree 管理与 Git 图谱在后续版本。
- Image backgrounds work in the packaged app but not under `npm run dev`. Terminals with a gradient or image background use the slower DOM renderer.
  图片背景仅在打包版生效（开发模式不显示）；使用渐变或图片背景时终端改用较慢的 DOM 渲染。

### Distribution / 发布
- Signed ad-hoc `.dmg` and `.zip` for Apple Silicon (arm64) and Intel (x64); macOS 13 or later.
  提供 Apple 芯片（arm64）和 Intel（x64）的 `.dmg` 与 `.zip`，需要 macOS 13+。
- The app tells you when a newer GitHub release exists (one notification per version; nothing is downloaded or installed automatically). No telemetry.
  有新版本时提示一次（不会自动下载或安装）；无任何遥测。

[Unreleased]: https://github.com/meloer101/terminal-reborn/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/meloer101/terminal-reborn/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/meloer101/terminal-reborn/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/meloer101/terminal-reborn/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/meloer101/terminal-reborn/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/meloer101/terminal-reborn/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/meloer101/terminal-reborn/compare/v0.1.1...v0.3.0
[0.1.1]: https://github.com/meloer101/terminal-reborn/releases/tag/v0.1.1
[0.1.0]: https://github.com/meloer101/terminal-reborn/releases/tag/v0.1.0
