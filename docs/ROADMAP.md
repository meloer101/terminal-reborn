# Wavi 路线图与进度

> 最后更新：2026-10-21
> 本文只记**做到哪了**：已完成什么、正在做什么、还没做什么。产品最终长什么样写在 [PRD](PRD.md)。
> 维护规则：完成、新增、取消一项时直接改这里（勾选、移动或划掉），更新顶部日期；不要另建任务单、验收记录或计划文档。验收结论写进对应里程碑下面，几行即可。

标记：`[x]` 已完成 · `[ ]` 未完成 · ~~划线~~ 已取消（原因写在后面）。编号 F1–F20 见 PRD §4；A / B / D 是第二阶段的条目编号。

## 当前位置

- 已发布 **v0.5.0**（2026-10-21：多 agent 第二批——这一轮跑过哪些检查、冲突雷达、一题多解 + 总览批量操作、多窗口；文件预览换行和 Markdown；状态准确性、隐藏终端不再重画、守护进程 SIGTERM 修复；之前是 v0.4.0，2026-10-20）。
- 下一步（2026-10-21 改）：**外部验证延后到 M5 / M6 之后**（PRD §1.5 v1.55），作者判断产品还不够成熟。多 agent 第二批已全部完成（2026-10-21，v0.5.0）；现在继续做第三批和 M5；分发里剩下的 brew、仓库改名、Discussions 和用户群，以及找人试用，都等那时再开始。
- 2026-10-20：定下多 agent 的方向——一个人消化多个 agent 的产出（PRD §1.2 v1.48），排期见下面“进行中：多 agent”；第一批三项已全部合进 main（2026-10-21：额度恢复和 F16 在 v0.4.0 里，状态准确性、规模基线和守护进程 SIGTERM 修复在 main 上，等下一个版本）。
- 2026-10-20：P0 里能交给 agent 的几项已合进 main（中文输入和链接、WebGL 中文乱码、手动确认项自动化、README 和 issue 表单、官网）。剩下的都要作者动手：Apple Developer 账号、推送 main 并开启 Pages、仓库改名、Discussions 和用户群，以及两份人工清单（清单在作者的「Wavi 待办清单与优先级」文档里）。

## 暂停：外部验证（原定 2026-10-19 → 2026-11-16，延后到 M5 / M6 之后，PRD §1.5 v1.55）

目标、指标和需求来源见 PRD §1.5。分发排在新功能前面；这 4 周新开的功能需求都要写明外部来源。

分发（先做）：
- [x] Apple Developer 账号 → Developer ID 签名和公证，下载后不再需要 `xattr -cr`（2026-10-20 流水线接通，v0.3.1-rc.1 试跑、v0.4.0 正式发布；自动更新仍留在 D5）
- [ ] Homebrew：自己的 tap，`brew install --cask` 一行装好。放在公证之后做，因为未公证的 app 经 brew 装上同样会被 Gatekeeper 拦
- [x] 官网 `site/` 部署到 GitHub Pages（2026-10-21 推送 main 后自动部署，https://meloer101.github.io/terminal-reborn/ ；英文版不在这一轮里）
- [x] README 按 v0.3.0 重写，中文在前，加“Wavi 不会做的事”四条（2026-10-20）
- [ ] GitHub 仓库改名为 `wavi`（原在“待作者手动确认”）：链接改动已备好，在分支 `claude/repo-storefront-01d834` 的 `e2acf43`（`package.json` 的 `repository` / `homepage`、README、CHANGELOG、打包和发布配置），作者在 GitHub 改名之后再合并；官网改 `site/index.html` 里那一处。已装 v0.3.0 的用户要靠 GitHub 的改名重定向收到新版本提示，所以 meloer101 下以后不能再建 `terminal-reborn`
- [x] issue 表单：bug 报告和功能建议，功能建议必填“现在怎么绕过去”（2026-10-20，`.github/ISSUE_TEMPLATE/`）
- [ ] Discussions 和用户群：作者开启 Discussions、建好群后，把链接填进 `.github/ISSUE_TEMPLATE/config.yml` 和 README「反馈」里的 `TODO(author)`

楔子必须先过的一关：
- [ ] 搜狗输入法、豆包输入法和系统拼音下的中文输入（原在“待作者手动确认”）。Orca 的 issue 里输入法吞字、重复上屏、选字被清掉这类问题反复出现，Wavi 在这里不能出错。自动化部分已完成（见下面“这期间修好的”）；还差真机清单 10 步，系统拼音、搜狗、豆包各走一遍

找人、收需求：
- [ ] 在中文开发者社区（V2EX、即刻、Linux.do 等）找同时跑多个 agent 的人，目标 10 个
- [ ] 5 次观察式试用（PRD §1.5），每次的卡点记进下面的“外部需求”
- [x] 竞品 issue 调研（2026-10-20）：三家共约 1.5 万个 issue（Orca 8,490、cmux 4,980、Superset 1,514）。结论：中文开发者有真实需求，但 Orca 已经在做（中文 README、微信群、中文界面），输入法正确只是入场条件；能拉开差距的是原生中文文案、多账号 / 第三方端点、多会话下的渲染稳定性。结果排进下面的“外部需求”
- [ ] 作者自己的三种来源（PRD §1.5）：离开日志、并行数翻倍跑一周、拿 Orca 当主力用 3 天再切回来

这期间修好的（2026-10-20，都来自竞品 issue 或自动化检查）：
- [x] 中文输入和链接：网址和文件路径碰到中文、全角标点就截断（o#30213）；全角标点被打成半角（o#6147）；双空格自动句号；输入法组合中按 Enter / Esc 误触发终端查找、设置里的字体搜索、新建会话面板等（o#17820 一类）。e2e `cjk-input.spec.ts`，单元测试 `links` / `file-links` / `ime` / `keymap`。取舍：路径里直接带中文的网址（如 `/wiki/中文`）会在 `/wiki/` 处截断
- [x] 8 个中文会话下的 WebGL 乱码（s#3572，上游修复 xterm.js#5883 在 7.0.0）：v0.3.0 确实会在字形图集合并后叠字、错字；`atlas-guard.ts` 让图集永远不合并（见 PRD §6.3）。压测 `TR_STRESS=1 npx playwright test e2e/webgl-cjk-stress.spec.ts`，修复前 56 次检查 34 次画错，修复后 0 次
- [x] 和 CC Switch 共存：Claude 被指到第三方端点（settings.json 的 `ANTHROPIC_BASE_URL`、Bedrock / Vertex）或 Codex 用非 `openai` 的 provider 时，会话头不再显示官方账号的额度，token 不计入份额，也不让账号算“在用”（PRD v1.46）。之前同时有官方登录的用户会在 Kimi 会话上看到“Claude 5h 12%”。单元测试 `bridge` / `server`（真实中继脚本）/ `codex-usage` / `transcript-meter`，e2e `session-meta` 新增一条（去掉渲染端的判断它会失败）
- [x] 守护进程收到 SIGTERM 不再结束全部会话（2026-10-21，PRD §6.8 v1.54；来自作者日志里的 3 次和长跑测试）：查证是停掉一棵进程树时连带发来的（Claude 桌面版退出时停掉开着 `npm run dev` 的后台任务，守护进程当时是应用的子进程），不是注销。守护进程改为启动即被 launchd 收养，SIGTERM 只写盘、照常运行；main 报告注销 / 重启 / 关机后才结束会话。单元测试 `sigterm.test.ts`、`daemon-client.test.ts`，e2e `pty-daemon.spec.ts`（父进程是 launchd；SIGTERM 后同一个 shell 还在，重开接回；报告关机后 SIGTERM 结束它们）
- [x] ⌘Q 后重开，守护进程保住的 agent 状态不再卡在“空闲”；弹窗里用真键盘按 ⌘F 不再在弹窗背后打开查找栏。新 e2e：`tui-apps`、`menu-keys`、`quit-keeps-agents`、`notifications`，另加随机事件序列下状态不卡死的性质测试

外部需求（每条写明来源；o = stablyai/orca，c = manaflow-ai/cmux，s = superset-sh/superset，cc = anthropics/claude-code，cx = openai/codex）：
- [ ] 国产套餐（GLM、MiniMax、Kimi）的额度显示。o#18506、o#21757。现在走第三方端点的会话只是不显示额度（v1.46）
- [x] 状态在 Auto mode、subagent、后台任务下的长时压测，顺带修“两个同时确认的工具调用互相顶替”（2026-10-20，PRD v1.52）。c#1027（44 👍：Running / Needs Input 时对时错）、c#2322（22 👍：通知时快时慢）、o#13600（Codex 自动批准后仍提示需要处理）。先核对了 Claude Code 2.1.304 二进制（`agent_id`、`background_tasks`、拒绝不发 PostToolUse、标题 `✳` = 有对话框，PRD §6.6），再按它写了会话模拟器 `src/shared/agent-sim.ts`，回放进状态机对照真实状态（`src/main/hooks/status-sim.test.ts`）。改动前：Claude 48 小时模拟里显示错误最长 266 s、超过 1 s 的错误占 5.5% 的时间，丢 5% hook 时最长 230 s，Codex 最长 39.5 s——主要是两个对话框互相顶替、子 agent 的调用把“等你处理 / 已完成”改回运行中、批准后工具在跑却还显示等你处理、空闲时 15 s 才检查一次。改后：每个对话框一个待确认项、子 agent 只算它的对话框、`idle_prompt` / 对话框后标题转动 / 屏幕上的对话框参与自愈、需要时立刻改用 1 s 检查（PRD §3.1）；最长 7 s、0.6%，丢 5% hook 时最长 7 s，Codex 最长 4.5 s。Claude 的 PermissionRequest 只在真要问人时触发（Auto mode 放行的不触发），所以 o#13600 那种误报在 Claude 上不会出现；Codex 的“Approve for me”没在真 CLI 上验证。测试：`status-sim.test.ts`（含丢 hook、完全没有 hook）、`session-state-machine.test.ts`（600 段随机序列：等你处理 ⇔ 有待确认项）、`normalize.test.ts`，e2e `asks.spec.ts`（真实 hook 链路），可选的 `TR_STATUS_STRESS=1 … e2e/status-stress.spec.ts`（假 agent 在应用里回放、对照侧栏）。真 CLI 下的并行对话框、后台 agent 请求权限和 agent teams 没跑（花额度，列在“待作者手动确认”）
- [x] 把文件和图片拖进或粘贴进运行中的会话（2026-10-20，PRD F19）：拖到终端上（Finder 或右侧栏「文件」视图）、⌘V 粘贴截图、会话头的回形针（文件和文件夹），都把转义后的路径放进输入行，agent 自己把图片变成附件。c#3435（22 👍）、o#15377。e2e `attachments.spec.ts`；从 Finder 真实拖入还没在真机上走一遍（拖入用的 `pathForFile` 和欢迎页拖文件夹是同一个）
- [x] 套餐额度用完后，恢复时继续（2026-10-20，PRD F11 v1.50）：会话因额度用完停下时，会话头（用完的 UsageChip 之后）和总览行写何时恢复，并给「恢复后发送“继续”」；点了才预约，按钮改写发送时间，再点取消。到点先复查账号额度（还在 100% 就顺延到新的重置时间），再看屏幕：有选择框（Claude 的 `/rate-limit-options`、Codex 的换模型弹窗）或 Claude 自己在倒计时继续时不发，发通知说明；在终端里打字、会话自己继续了就取消。额度用完的错误条不再给“让 agent 修复”。先实测了两家怎么报告限额（PRD §6.6 / §6.7，`scripts/spikes/60-rate-limit-lab.mjs`，本地模拟 429，不花额度）：Claude 是 `rate_limit` 的 StopFailure，Codex 不发任何 hook、之后弹换模型菜单（往里打“继续”回车会换掉模型）；Claude 2.1.304 自己有 `autoContinueAtUsageLimit`。cc#13354（215 👍）、cc#35744（106 👍）、cx#21073（85 👍）、cx#28931（60 👍）。单元测试 `limit-resume.test.ts` / `normalize.test.ts` / `error-next-steps.test.ts`，e2e `limit-resume.spec.ts`。预约不跨 ⌘Q（只在窗口页面里，见已知问题）；Figma 待补（按钮和预约状态，现在照 `/compact` 的样式）；“每次限额自动预约”没做，有人提出再放进设置 · 自动化、默认关。随后其他点击发给 agent 的操作（错误条的“重试这一轮”“让 agent 修复”、审阅、评论和浏览器错误的“发给 …”、插入路径、冲突交给 agent、/compact 按钮）也在这些菜单开着时不打字，提示“终端里有选择框，请先在终端中处理”（`sendRefusal()`，单元测试 `send-protocol.test.ts` / `session-io.test.ts`，e2e 同上；合并面板的 `merge-sheet.spec.ts`）。拒绝的提示写在被点的地方：合并面板留在原处并在失败行说明，文件视图标题下一行，/compact 下的小浮层
- [ ] Option 当 Meta 的设置项（现在只映射了 ⌥← / ⌥→）。s#1359、c#2120
- [ ] 中文文案通读，统一术语。o#29320、o#8553（Orca 的机翻）
- [ ] 排查中文分支名在旧版 Apple Git 上被截断（Wavi 也用了 `%(refname:short)`，本机没复现）。o#19515
- 先访谈再定：多账号 / 按会话的启动配置（o#11557 17 👍、o#9496、o#9239、c#3317、s#8179；2026-10-20 搁置：换服务商大家用 CC Switch，它改的 `~/.claude/settings.json` Wavi 的会话本来就读；换订阅账号 /logout 再 /login；只剩“两个账号同时跑”，等有用户提出。设计稿留在 Figma 第 19 节，标了搁置）、多仓库任务（o#7568、s#2364，各 21 👍）、非 GitHub 主机的 PR（o#4703、o#21181、o#15421）、繁体中文界面（o#10592）、国内网络下的安装和更新（三家 tracker 里几乎没人提）

待验证想法（作者自己想到、还没有外部来源，到期再看）：
- 暂无

到期决定（原定 2026-11-16，随外部验证顺延）：
- [ ] 按 PRD §1.5 的三种结果做出决定，结论写在这里

## 进行中：多 agent——一个人消化多个 agent 的产出（2026-10-20 定）

方向见 PRD §1.2（v1.48）。来源是 2026-10-20 的调研：GitHub issue（cc = anthropics/claude-code，cx = openai/codex，加上 o / c / s）、HN / Reddit / Product Hunt、竞品文档，以及 Anthropic、OpenAI 和一线实践者公开的工作流。结论：开会话、看状态正被各家原生产品吸收；审阅、验证、合并和 agent 之间互相踩还没人做好。下面每一条都有外部来源，符合 §1.5 的要求。

第一批（2026-10-21 已全部合进 main）：额度恢复后继续（F11 扩展；cc#13354 215 👍、cc#35744 106、cx#21073 85、cx#28931 60）· 状态准确性和 20 会话基线（见上面“外部需求”和 D1）· F16 PR / CI（见 M5）。

第二批（Wavi 的差异化：审得完、合得进）：
- [x] F20 主区分屏（2026-10-20，Figma 21 Section `301:15658`，PRD v1.49）：从侧栏把会话拖进终端区域（中间替换、边上多一格，已在显示的是挪动 / 互换），拖会话名挪格，细线拖动调大小、双击等分；⌘D / ⇧⌘D 新格先选会话（可过滤），⌥⌘ 方向键换格，⌥⌘W 关格，菜单「显示」里都有；右侧栏、⌘F、回形针、⌘V 跟着键盘所在的格，分屏时 ⌘+ / ⌘- 只调这一格；侧栏标出所有在显示的会话；“看得见”= 任何一格里显示；排法存进 workspace.json，重启恢复，会话关闭 / 归档后其余格补位；总览浮层不变。拆分树在 `src/shared/split-layout.ts`（总览浮层的落点判断也改用它），界面在 `src/renderer/split/`。测试：`split-layout.test.ts`、`workspace-model.test.ts`、`workspace-file.test.ts`、`controller.test.ts`、`split/model.test.ts`，e2e `split.spec.ts`（21A–21H 两种主题截图）、`split-restore.spec.ts`、`menu-keys.spec.ts`。4 格同时输出时的打字延迟见 D1。以后：一格拖出成独立窗口（下面“多窗口第二步”）。cc#30154（264 👍）、o#8377（合并了 o#6197 等）、cc#27725（70）、c#3297（25）
- [x] 冲突雷达和合并顺序（2026-10-21，最小版，PRD F4 v1.57、§6.13）：主进程 `src/main/conflict-radar.ts` 对同一仓库的活跃 worktree 两两、以及各自对基线跑 `merge-tree --write-tree`（和合并预检共用 `mergeTreeConflicts`），未提交改动在临时 index 里快照后也算；只在 ref 变化（防抖 1.5 s）、一轮结束、窗口获得焦点时重算，按两边的提交缓存，最多 2 个 git 进程，git < 2.38 时隐藏。总览列表的“冲突”列、看板浮层标题栏、Worktree 行和详情写“和 xxx 会冲突” / “和 main 会冲突” / “main 已前进 · 落后 N”，悬停列文件；Worktree 详情“让 agent rebase”把 rebase 说明放进输入行、不按回车。纯逻辑 `src/shared/conflict-radar.ts`（排程、合并后谁落后、标记文字）和 `src/renderer/conflict-radar/model.ts`（rebase 说明）。测试：`src/main/conflict-radar.test.ts`（临时仓库：冲突的一对、未提交改动且 index 不变、缓存只重跑受影响的、squash 合并后被合并的退出 / 其余落后或和 main 冲突、20 个 worktree 首次约 1.1 s），`src/shared/conflict-radar.test.ts`、`model.test.ts`，e2e `conflict-radar.spec.ts`（3 个 worktree，截图在 `test-results/conflict-radar/`，两种主题）。**Figma 还没有画面**（总览的冲突列、浮层标题栏、Worktree 行和详情、“让 agent rebase”），现在照 PrTag 和 Worktree 详情的样式。以后：合并面板合并完成后列出受影响的 worktree、建议的合并顺序；没在真实大仓库上测快照耗时。讨论很多（HN 47866750 279 分、r/ClaudeCode 1vtfawm），但几乎没人开 issue（o#18487、cc#74532），先看用的人多不多
- [x] “这一轮跑过哪些检查”（2026-10-21，PRD F9 / F4 v1.56）：从 PostToolUse 的 Bash 调用（命令 + 退出码 / 输出）在本地分出测试 / lint / 类型检查 / 构建，按“上次 UserPromptSubmit 以来”汇总每项检查最后一次的结果；总览“待审阅”行（列表和看板）写 `测试 ✓ · lint ✗ · 类型 未跑`，合并面板多一行（最差的结果 + 每条命令），只提示、不挡合并。`npm run check` 这类脚本按 package.json 展开；管道、`; echo` 之后看不到退出码时读测试工具自己的汇总行，读不出就写“看不出结果”；Codex 没有退出码（§6.7），同样靠汇总行。这一轮只聊天时显示“上一轮”。分类和汇总在 `src/shared/check-commands.ts` / `turn-checks.ts`，main 在 hook bridge 里算（和 todo 同一路径）。测试：`check-commands.test.ts`、`turn-checks.test.ts`、`normalize` / `codex-normalize` / `bridge` / 合并面板 `model` 的单元测试，e2e `turn-checks.spec.ts`（假 claude 跑真实 hook，两种主题截图在 `test-results/turn-checks/`）。**Figma 还没有这一项的设计**：总览行（11 v2）和合并面板（05）需要补一帧，现在按两处现有的元数据和清单行的样式做。回应“agent 说做完了，其实没过”（社区里有人审计过：报告做完 10 个，能用的 7 个）和 OpenAI 的“瓶颈变成人工 QA”。不花 token
- [x] 一题多解 + 广播（2026-10-21，PRD F4 / F9 / F15 v1.60，P2 的 best-of-N 和 F9 批量操作一起做）：新建会话面板「智能体 · 多个」选份数（Claude Code / Codex 各一个计数，一共 2–4 份）、写一段任务，「创建 3 个并发送」在同一基线上依次建 N 个 worktree，每份的 agent 不管显示没有都立即启动，起来后按 §6.9 发送并按回车，每份只发一次；组存进 workspace.json（`attemptGroups`，旧文件照读）。总览顶部“一题多解”一节每组一行，「比较」打开浮层并排各份，标题栏下的对比条写 `+N −M · N 个文件`、这一轮的检查、发送进度、「看 diff」「合并这个」；合并一份后合并面板和组行提供「归档其余 N 份」，确认后才逐个归档。广播：总览 ⌘ / ⇧ 多选，底部条「发送消息…」「停止 N 个」（发 Esc）「关闭 N 个」，确认框引用原文、列出每个收件人，确认后才发。纯逻辑 `src/shared/attempt-groups.ts`、`batch-actions.ts`，界面 `src/renderer/attempts/`、`overview/BatchBar.tsx`；不加新的 IPC（建 worktree、读 diff、确认框都用现有的，main 照常校验）。测试：`attempt-groups.test.ts`、`batch-actions.test.ts`、`workspace-file.test.ts`，e2e `attempts.spec.ts`（假 Claude ×2 + 假 Codex，两种主题截图在 `test-results/attempts/`）。**Figma 还没有画面**：面板的「多个」、总览的组行和对比条、批量条都照 15 / 11 v2 现有样式做，需要补帧。以后：按检查和 diff 大小给各份排序、组在列表里折叠成一行。Orca、Emdash 已有；HN 上“同一句澄清发给几个 agent”的需求
- [x] 多窗口第二步（2026-10-21，PRD F20 · 多窗口 v1.58）：把一格的会话名或侧栏里的会话拖到窗口外松开，在松开处成为新窗口；项目菜单「在新窗口中打开」、「文件 › 在新窗口中打开项目…」⇧⌘O 给项目开自己的窗口（侧栏只列这个项目），「显示 › 把这一格移到新窗口」和会话的右键 / … 菜单「移到新窗口」。每个窗口自己的拆分和键盘所在的格，会话共用、只在一处显示，跳到会话时把它所在的窗口调到前面；关副窗口不结束 agent；所有窗口、位置、全屏存进 workspace.json（可选的 `windows`，旧文件不用迁移），重启恢复。所有窗口由同一个渲染进程绘制（`window.open('about:blank')`），终端换窗口只挪 DOM，回滚和 PTY 流不断，所以 20 会话的规模基线不受影响。纯逻辑 `src/shared/window-layout.ts`，main 在 `src/main/secondary-windows.ts`，渲染端 `src/renderer/app-shell/secondary-windows.tsx`、`SecondaryShell.tsx`。测试：`window-layout.test.ts`、`workspace-file.test.ts`、`split/model.test.ts`，e2e `multi-window.spec.ts`（在新窗口打开项目、拖出一格、关副窗口、菜单移到新窗口，副窗口两种主题截图）、`multi-window-restore.spec.ts`（重启恢复、关掉的不再恢复）。o#6074（38 👍，原话“多窗口是基本盘”；Orca 至今没有）、cc#30154、cc#27725
  - [ ] 副窗口里的右侧栏和总览（这一版只在主窗口，从副窗口打开会把主窗口调到前面）；浏览器视图是挂在主窗口上的原生视图，要先能换窗口
  - [ ] 拖到另一个已经打开的 Wavi 窗口上松开 = 挪进那个窗口（现在一律新开窗口）
  - [ ] Figma 补副窗口、拖出时的提示和空窗口的帧（现在沿用 21 的组件）
  - [ ] 真机走一遍：两块显示器（不同缩放）、副窗口全屏成为单独桌面、合盖 / 拔显示器后恢复位置；e2e 只在一块屏上跑

第三批（先实测或先访谈）：
- [ ] agent teams 的队友显示成侧栏里的会话：学 cmux 用 shim 接住 tmux 分屏请求，先实测 Claude Code 当前版本能不能接。cc#24122（96 👍）、cc#24189（74）、cc#26572
- [ ] 手机提醒：不做 App，“等你处理”推到 Bark / ntfy / 飞书 / 企业微信机器人，设置里打开、默认关闭。cc#29438（69 👍）、cc#28765（44）、Superset Mobile（Product Hunt 当日第一）
- [ ] 读 `claude agents --json`，把 Claude 自己在后台开的会话（会自己建 worktree、开 draft PR）也显示到总览

暂不做（追竞品清单，PRD §1.2 不追；单条需求票数也低）：Linear / Jira 接入、SSH / 云 VM / 手机 App、多仓库工作区（仍在上面的“先访谈再定”）、自动合并。

## 已完成

### M0 · 工程地基与技术预研（2026-10-13）
- [x] electron-vite 脚手架、MIT 许可证、README、CI（typecheck · lint · Vitest · Playwright）
- [x] Figma 变量导出为 `tokens.css`（深色 + 浅色），应用外壳
- [x] 预研：发送协议、Codex 粘贴突发、`--settings` 合并（结论见 PRD §6.6、§6.9）

### M1 · 终端 + 输入栏（2026-10-13）
- [x] PtyHost、多会话、`TerminalSurface`、xterm 配置、键位映射
- [x] 输入栏和发送协议，Claude 发送矩阵 8 / 8 通过（输入栏后来在 v1.2 取消）
- [x] 手动添加项目和会话、按会话启动 agent、启动弹窗保护

### M2 · 状态与即时回复（Claude）→ MVP（2026-10-14）
- [x] 按次注入的 hooks、HookServer、状态机与自愈；侧栏、系统通知、Dock 角标
- [x] 权限确认、AskUserQuestion 点选与数字键作答（v1.2 改为只做状态）；⌘K 基础版
- [x] 会话标题默认取首条 prompt

### M3 · 外观设置 + Codex 适配 → v0.1.0（2026-10-14）
- [x] 设置 · 外观：中英文字体分别设置、字号、行高、连字、侧栏毛玻璃、浅色 / 深色、实时预览
- [x] Codex：按次注入 hooks、固定信任、权限确认、标题判断状态、空闲时 Ctrl+C 保护
- [x] 打包（arm64 / x64 的 dmg + zip）、图标、新版本提示、发布流水线（ad-hoc 签名，未公证）

### 2a · 可靠性 → v0.1.1（2026-10-15）
- [x] A1 关窗口只隐藏；⌘Q、⌘W、移除项目前确认；正式版去掉 Reload / DevTools
- [x] A2 重启后首次打开会话用 `--resume` 接上原对话
- [x] A3 agent 不在运行时不把文字当命令发给 shell
- [x] A4 `/clear`、`/resume` 后状态不再卡在“已退出”
- [x] A5 终端进程崩溃后自动重启，可一键全部恢复
- [x] A6 启动中、被信任弹窗挡住时如实显示
- [x] A7 中断后几秒内回到空闲
- [x] A8 找不到命令、目录不存在、hooks 不可用时明确提示
- [x] A9 hook socket 移到 userData 并自愈
- [x] A10 设置写入失败后仍能继续保存
- [x] A11 关闭运行中的会话、移除项目前确认
- [x] A12 工作区、草稿、窗口位置改由主进程原子存储，自动迁移

### 2b · 日常体验 + 总览 → v0.2.0（并入 v0.3.0 发布，2026-10-19）
完成标准：Figma 09 / 11 还原；下面的未完成项全部关闭。
- [x] 改名 Wavi（appId、`TERM_PROGRAM`、旧配置自动迁移；`npm run dev` 用独立配置）；`npm run app:install` 链接版安装，构建后自动刷新 / 提示重启（2026-10-18，PRD v1.11）
- [x] B10 没有会话时主区给出下一步（打开项目、拖入文件夹；2026-10-17 由 B20 欢迎页取代）
- [x] B11 未完成的入口先隐藏；会话标题栏 “…” 菜单（重命名、在 Finder 中显示、复制路径、关闭会话）
- [x] B13 主区最小宽度 560，放不下时右侧面板浮层显示并带关闭按钮
- [x] B1 会话可以重命名（双击标题或 “…” 菜单）；标题移出窗口拖拽区，真实双击才到得了页面（2026-10-18）
- [x] 会话标题用 agent 自己起的名字（Claude `ai-title` / Codex `thread_name`，Wavi 只读不生成）；Wavi 重命名过的不再被替换；旧版存下来的首条 prompt 标题在恢复会话时升级（2026-10-18，PRD v1.14）
- [x] PRD §3.3 侧栏层级：项目 › 会话，项目可折叠；取消置顶队列（替代 B3）
- [x] F9 状态总览 v2（2026-10-17）：列表原地展开终端、看板状态色块卡片、会话浮层；列表去掉分隔线、隐藏空分组（2026-10-18，PRD v1.15）；看板浮层放大，并支持并排最多 4 个会话、拖动换位置和调整大小、拖边缘调整整个浮层（2026-10-20，PRD v1.39–v1.42）
- [x] PRD v1.2 “终端就是全部界面”：去掉输入栏、PromptBar 和生命周期卡片；终端行高 1；终端底色跟随主题
- [x] PTY 守护进程（从 M6 提前，2026-10-16）：⌘Q 后 agent 继续运行，重启接回同一进程；关闭期间的 hook 事件会补放；“退出并结束所有会话” ⌥⌘Q

- [x] B2 侧栏第二行：一轮结束后显示最后一句回复（Stop hook 的 `last_assistant_message`，重启后保留），时间列显示“3m 前”
- [x] B4 “已完成 · 未读”在侧栏补上文字和最后一句回复，不只靠颜色
- [x] B5 / F10 侧栏和总览时间按状态切换：运行中为本轮用时，等你处理为“已等 3m”（从开始等待算起，超过 5 分钟加粗），其余为“5m 前”
- [x] B6 / F10 通知写“项目 · 会话”和问题或最后一句回复；1 s 内完成的多个会话合并成一条，点击打开总览
- [x] B7 新建、打开或再次选中会话后焦点自动进终端（包括 ⌘K 选中、⌘O 打开已有项目、恢复后首次启动）
- [x] B8 快捷键和菜单：⌘\ 侧栏、⌘⌥B 右侧栏、⌘F、⌘+ / ⌘- / ⌘0；“文件 / 编辑 / 会话 / 显示 / 窗口”菜单全部中文；快捷键显示在菜单、⌘K 和侧栏
- [x] 侧栏快捷键改为 ⌘B（左侧栏）/ ⇧⌘B（右侧栏），同 VS Code（2026-10-18，PRD v1.20）
- [x] B9 侧栏收起时标题栏提示“N 个会话需要你”（计数同 Dock 角标，点击打开总览）
- [x] B15 设置：英文字体只列实测等宽的字体（名字只在无法测量时兜底）；中文字体按简体 / 繁体 / 日文 / 韩文 / 其他分组，可搜索；“恢复默认”重置除主题外的外观设置
- [x] B16 用语统一为“打开项目”“终端”“新建 Claude Code 会话”；⌘K 会话顺序与侧栏一致，侧栏可见的前 9 个显示 ⌘1–⌘9
- [x] B17 主题自己变成深色：dev 与正式版共用 settings.json 但 localStorage 分开，旧的 `tr.theme.v1` 每次启动都会被迁移进设置——迁移已删除；主题色块上的方向键只移动焦点（Space / Enter 才选中）；⌘K 的 ↑ 不再从第一项绕到列表末尾的主题操作
- [x] B18 终端内搜索 ⌘F（计数、区分大小写、↵ / ⇧↵）、设置 · 辅助功能 · 读屏模式、WebGL 丢失后下次显示时重试（连续丢失 3 次才固定用 DOM 渲染）
- [x] B19 终端选区 ⌘C / ⌘V：⌘A 全选、拷贝（含中文）、无选区时不改剪贴板也不发 ^C、粘贴、bracketed paste 包裹均有 e2e；agent TUI 开启鼠标上报时可按住 ⌥ 拖动选中（之前完全无法选中）
- [x] 出错的会话给出下一步：终端下方的条带写出错误；“让 agent 修复”（进程已退出时先 `--resume` 接上，再按发送协议把错误发给 agent）；“重试这一轮”（发“继续”）或“重新启动”；启动类问题（找不到命令、目录不存在）只说明原因
- [x] “等你处理”改用品红（2026-10-18，PRD v1.24）：Figma 变量和 `tokens.css` 一起换，总览看板的 `card/attention*` 同步；琥珀只留给图谱第 4 条 lane 和终端黄色
- [x] 侧栏与主区之间的分隔线换成主区左侧圆角 16（2026-10-20，PRD v1.43）
- [x] 右侧栏改为浮在主界面底板上，开毛玻璃时四周留白不再变色（2026-10-20，PRD v1.45）
- [x] 侧栏可拖右边缘调宽（200–480，保存，双击恢复 264），主区取剩余宽度（2026-10-20，PRD v1.44）
- [x] B20 / F18 欢迎页重做（Figma 14）：问候 + 一句话 + 一个下一步，有项目时换成快捷键提示；Claude Code 和 Codex 都没装时出现 agent 选择和安装命令；去掉最近项目和“已安装”列表；侧栏空状态只留一行
- ~~B12 选项条文案和焦点~~：PromptBar 已在 v1.2 取消
- ~~B14 浅色主题配渐变背景时文字看不清~~：渐变 / 图片背景已取消

### M4 · Worktree 全链路 + Diff 审阅 → v0.3.0（2026-10-19）
完成标准：Figma 03 / 05 / 15 还原；L1 / L4 / L5 完整跑通；git 操作有基于临时仓库的集成测试。
- [x] F4 新建会话面板 ⌘N（2026-10-18，Figma 15，PRD v1.12 / v1.13）：项目 · 工作目录（新 worktree / 当前目录，按项目记在 workspace.json）· 基于（可搜索，本地 / 远程两组，已在其他 worktree 里的分支改为在那里开）· 智能体 · 高级（分支名 `<前缀>/<两个词>` · 文件夹 · 准备）；不写任务、不送首条 prompt；非 git 文件夹和分支名重复的提示；⌘N、项目标题 ＋、空项目的“新建会话”、Worktree 视图 ＋、⌘K “新建会话…”都打开面板，会话右键“在此新建会话”直接开；e2e `new-session.spec.ts`（15A–15G 两种主题截图）
- [x] F4 新 worktree 的后台创建（2026-10-18）：fetch、`worktree add --no-track -b`（本地基线只是落后 upstream 时从 upstream 开）、`branch.<name>.base`、按 `.worktreeinclude` 复制被忽略的文件（APFS 克隆）；会话先出现、终端等文件夹建好再启动，失败时在会话下方说明；主进程测试 `worktree-create.test.ts`。setup 脚本跟下面 `.tr/settings.toml` 一项一起做
- [x] 浮层玻璃材质（2026-10-18，PRD §5）：新建会话面板和它的下拉菜单，“降低透明度”时回退实心；tokens.css 加 `--bg-popover` 和 `--glass-*`、`--radius-sheet / popover / button-glass`
- [x] Select 和分段按钮去掉边框，只用色块（2026-10-18，`settings/controls` 和新建会话面板）
- [x] 分段按钮共用 `ui/Segmented`，选中色块用弹簧曲线滑到新选项、宽度跟着变（2026-10-18；新建会话、总览列表 / 看板、Git 图谱 / 变更、安装 agent 选择；tokens `--motion-spring` / `--motion-duration-slide`；首次显示和尺寸变化不动画，“减少动态效果”时直接跳）
- [x] F4 `.tr/settings.toml` 脚本与端口（2026-10-19，PRD v1.26；闭环的界面 2026-10-18，PRD v1.28，Figma 16A / 16B）：`[scripts]` setup / run / archive / 可选 test（`smol-toml` 解析，未知键忽略）；第一次运行和内容改变后弹确认框列出全部命令，批准的哈希按仓库记在 `repo-scripts.json`（没有 test 时哈希与以前相同）；新 worktree 的终端里 setup 先于 agent 运行，失败时会话下方说明、“仍然启动”后照常启动，新建会话面板的“准备”写明会运行 setup；会话头 Run 按钮（开始 / 切过去 / 停止，单独的 `run` 终端会话）；每个工作目录 10 个端口、默认 41000 起（设置 · Worktree 可改起点，已分配的目录不变），`TR_PORT` 注入该目录的每个终端；Worktree 详情显示端口段；合并预检在能合并时跑 `test`，失败不能合并、取消会停掉进程；单元测试 `repo-scripts` / `ports` / `script-launch` / `script-run`，e2e `repo-scripts.spec.ts`、`settings.spec.ts`、`merge-sheet.spec.ts`、`worktree-panel.spec.ts`。`archive` 随 F15 运行（2026-10-19）
- [x] F4 本地合并（2026-10-18，Figma 05，PRD v1.21）：合并面板 ⇧⌘M（变更视图、Worktree 详情、“会话”菜单）；预检 = 领先 / 落后、`merge-tree --write-tree` 冲突检测、未提交改动、基线 upstream 未拉取、merge / rebase 进行中、基线目录的冲突改动；Squash（默认）/ Merge / Rebase，内存里建提交，基线最后一步前移（`merge --ff-only` 或 CAS `update-ref`），失败不留半截；可选合并后删除 worktree（保留分支，会话一起关闭）和推送到 origin；冲突时“交给 Claude / Codex 解决”（只放进输入行、由用户按回车，PRD v1.22）；主进程测试 `git-merge.test.ts`（临时仓库），e2e `merge-sheet.spec.ts`（05A–05C 两种主题截图）。可选测试命令已接上（PRD v1.28）。以后：图谱右键合并。合并后自动归档已接上（F15，2026-10-19）
- [x] F17 右侧栏外壳（2026-10-17）：浮层卡片、会话头四个切换图标、⌥⌘B 记住上次的视图、宽度可拖拽并保存（400–1200）、跟随当前会话的 worktree；tokens.css 加 `--bg-float` 和 `--shadow-pane`；浏览器 / Git / Worktree 视图暂为占位
- [x] F5 / F17 Git · 变更视图（2026-10-17，Figma 13B2）：未提交 / 已提交（对比基线；本地基线落后时对比 origin；在基线分支本身上对比 upstream）分组、领先 / 落后、展开单个文件的 unified diff（只渲染可见行；嵌套仓库、超大文件不展开）、文件变化时每秒最多刷新一次；e2e `git-panel.spec.ts`，主进程测试 `git-graph.test.ts`
- [x] F5 行内评论（2026-10-18，Figma 03，PRD v1.23）：diff 行悬停 ＋、⇧ 点击扩成范围、⌘↵ 添加 / Esc 取消、编辑和删除；评论按 worktree 存进 workspace.json；“发给 Claude · N”合成一条说明放进输入行（不回车），“放弃”需确认；e2e `review-comments.spec.ts`
- [x] F5 并排 diff（2026-10-19，Figma 17F / 17G / 17H，PRD v1.31）：「统一 / 并排」分段（只在变更里），右侧栏 ≥ 720 才能并排，否则置灰提示并回退，选择存在 workspace.json；一段改动里删除和新增逐行配对、对面空缺用 `bg/hover` 填，hunk 横跨两栏；＋ 和评论只挂在右边（新）；e2e `diff-split.spec.ts`
- 还没测：1 万行 diff 实际滚动帧率（行已窗口化）。“创建 PR”移到 M5（F16 之后）
- [x] F17 Worktree 页签（2026-10-17）：`git worktree list` + 会话状态、未提交 `+N −M`、领先 / 落后，选中行展开详情和操作（打开文件夹 · 在此新建会话 · 复制路径 · 删除），可清理分组一键清理（只碰没有会话、已合并的）、没有会话分组逐个删除；删除在有改动、git 检查失败、分离 HEAD 有孤立提交、变基中、会话在跑时拒绝；监听 `.git` 变化 + 可见时轮询；e2e `worktree-panel.spec.ts`。以后：`worktree list -z`、lock 原因、squash / rebase 合并识别、删除时可选删分支（`branch -d`）、手动刷新和逐行错误、`core.fsmonitor=false`、我们 PTY 之外 cwd 在 worktree 里的进程。+ 已打开新建会话面板（2026-10-18）；“合并到 main…”已接上 F4（2026-10-18）；端口段显示预留的 TR_PORT 段（2026-10-18，PRD v1.28）
- [x] F17 文件页签（2026-10-17）：按需加载的目录树 + git 状态、筛选和“有改动 N”、只读预览（行号 + 改动标记）、用默认编辑器打开、右键菜单、`fs.watch` 增量刷新；e2e `right-panel.spec.ts`。还没测：1 万文件仓库首屏 < 200 ms、切换会话 100 ms 内换内容
- [x] F13 一键 AI 审阅（2026-10-18）：“让 agent 审阅”在变更视图底部和总览“待审阅”行（展开后 / 浮层），向 Claude 发 `/code-review`、Codex 发 `/review`；agent 忙或未就绪时置灰写明原因，已退出的先 `--resume`；e2e 在 `merge-sheet.spec.ts`。2026-10-19 起默认走后台审阅，这条路径留作“审阅方式 · agent 自带命令”
- [x] F13 后台审阅（2026-10-19，PRD v1.29）：主进程 `src/main/background-review.ts` 起只读的 `claude -p` / `codex exec`（登录 shell 的 PATH、提示走 stdin），diff 含未提交、未跟踪文本文件和对比基线的已提交，每段最多 40 万字符；结果落成带 P0–P3 和置信度的 F5 评论（P2 / P3 折叠、默认不勾，只发勾选的），变更视图底部显示状态、用时和花费、可取消；按 diff 哈希去重，新 diff 取消旧审阅；合并面板一行审阅状态和“先审阅”；设置 · 自动化 · 代码审阅（三个时机默认关，一轮结束用 prompt-submit / Stop + HEAD 比对）。测试：`src/main/background-review.test.ts`（真 git 仓库 + 假 CLI），e2e 在 `merge-sheet.spec.ts`、`settings.spec.ts`。以后：真实 Codex 服务商上的结构化输出仍没跑通（§6.10）；审阅结果没有持久化，重启后同一 diff 会再审一次
- [x] F15 归档（2026-10-19，Figma 16D，PRD v1.30）：会话右键“归档 worktree…”和 Worktree 详情“更多”打开 16D 面板；停会话（保留屏幕快照）→ 批准后运行 `archive`（失败可“仍然归档”）→ `src/main/archive-ref.ts` 把 HEAD、暂存区、未提交和未跟踪文件存进 `refs/wavi/archive/<id>` → 侧栏、总览、⌘K 会话和 ⌘1–9 里收起；会话在运行时不能归档。⌘K“历史”恢复：文件夹在就不动，没了就 `git worktree add` 回原分支（分支没了从快照重建）并放回改动，再删 ref；agent 第一次查看时 `--resume`。设置 · Worktree“合并后自动归档”（默认关）。测试：`archive-ref.test.ts`、`archive.test.ts`（真 git 仓库）、`workspace-model.test.ts`、`entries.test.ts`，e2e `archive.spec.ts`（16D 两种主题截图）。以后：历史里删除归档、归档太久的提醒和清理、Worktree 列表里标出已归档
- 可以并行（与 git 无关）：
  - [x] F11 上下文占用与额度（2026-10-19，Figma 17，PRD v1.31）：Claude 用按次注入的 statusLine 中继（`resources/hooks/tr-statusline.sh`，串联并原样输出用户自己的 statusLine），Codex 在 hook 之后读 rollout 的 `token_count`（`src/main/hooks/codex-usage.ts`，实测见 PRD §6.7）；会话头 `context 62%`（≥ 80% 加重 + `/compact` 只放进输入行，悬停显示 token 数）和本会话厂商的额度（用得最多的窗口），点开按厂商列出；额度由主进程保存（`plan-usage.json`）、发给所有窗口；总览顶栏每个厂商一个额度标签、行里 context 列；会话头变窄依次去掉 todo 当前项 → 厂商名 → 分支名；e2e `session-meta.spec.ts`（假 claude 跑真实的 `--settings`）。真实 ChatGPT 账号的 Codex 额度响应头没在本机验证（服务商 503）。浮层精简（PRD v1.34）：context 浮层去掉明细和 /compact，额度浮层去掉来源说明。准确度（2026-10-20，PRD v1.38）：额度改为主动问账号（Claude 无头 `get_usage`、Codex `app-server` `account/rateLimits/read`，`plan-usage-poller.ts` / `account-usage.ts`），与会话读数按窗口合并，按模型的周额度，速度按最近一小时斜率，份额按 API 价格；context 刻度 / 曲线 / 预测改按 agent 自己的自动压缩点，/compact 后不留旧数；单测覆盖轮询、合并、两种答案和假 CLI，e2e 设 `TR_ACCOUNT_USAGE=off`。真实 ChatGPT 账号的 Codex 轮询没在本机验证（本机是 API key）
  - [x] F11 可视化（2026-10-19，Figma 18，PRD v1.32）：先调研 Claude Code `/context` `/usage`、Codex `/status`、ccusage、Claude-Code-Usage-Monitor、ccstatusline、CodexBar、Cline / Roo、Cursor、Warp 的做法。标签加小条（额度带“时间过了多少”竖线），点击打开 ContextPopover（80% 刻度、每轮曲线和压缩点、“大约 N 轮后”、缓存 / 输出 / 折算成本）和 UsagePopover v2（每个窗口的时间进度和用完预测、用完时显示恢复时间、各会话份额、“可能不是最新”）；额度提醒 75% / 90% / 用完各一次（设置 · 自动化，默认开）。主进程 `src/main/hooks/transcript-meter.ts` 增量读 Claude transcript / Codex rollout；测试 `transcript-meter.test.ts`、`usage-store.test.ts`、`session-meta.test.ts`，e2e `session-meta.spec.ts`（18A / 18B / 18C 两种主题截图）。以后：额度历史曲线（跨重启要落盘）、Wavi 之外的用量
  - [x] 普通终端里手动敲的 `claude` / `codex` 也有 context / todo / 额度（2026-10-19，PRD v1.33）：终端会话 PATH 最前放 shim（`resources/hooks/agent-shim.sh` + `src/main/hooks/shell-agents.ts`），交互式运行时补 `--settings` / Codex `-c`，结束时报告 `AgentExit`；zsh 用 ZDOTDIR 交接、fish 用 vendor_conf.d 保证 shim 在用户 rc 之后仍在最前；不写全局配置。测试 `shell-agents.test.ts`（真 sh 跑 shim）、`bridge.test.ts`，e2e `session-meta.spec.ts`（终端里敲 claude 出现 context 和额度，退出后消失）。以后：终端里手动启动的 agent 也驱动会话状态和通知；`alias` 到绝对路径时的被动识别
  - [x] F12 todo 进度（2026-10-19，Figma 17）：PostToolUse 的 TodoWrite / TaskCreate / TaskUpdate 在主进程里合成列表（/clear 清空，窗口重载时补发）；会话头 `3/7 · 当前项` + 只读 TodoPopover，侧栏 1px 进度线，总览 `3/7` 列。注意 Claude 2.1.303 对 Claude 5 模型默认不开 todo 工具（PRD §6.6），Wavi 不替用户打开
  - [x] F14 端口检测（2026-10-19）：有会话时主进程仍用 `src/main/browser/ports.ts` 的 `ps` + `lsof`，大约每 3 秒扫每个 PTY 进程树（不再只在浏览器页签打开时扫）；窗口订阅每个会话的最近一次结果，所以侧栏会话行和总览在重载后也能显示 `:5173`，不必先打开浏览器页签；点击在右侧栏浏览器打开，⌥ 点击用系统浏览器打开，右键结束进程。主进程只结束该会话最近一次扫描里的 pid（`sessionListener`），没有通用的杀进程 IPC。同一会话超过 2 个端口时其余收成 `+N`；e2e 在 `browser-panel.spec.ts`（关着浏览器页签时侧栏和总览出现标签、⌥ 点击、右键确认后结束）
  - [x] F17 浏览器页签（2026-10-17）：`WebContentsView`（每个 worktree 一个 `persist:tr-browser:<哈希>` 分区、无 preload、只允许 http(s)、新窗口要有用户操作）、每个 worktree 一个页面并记住 URL、地址框（纯数字 = localhost 端口）、worktree 内所有会话的端口条、375 手机视口、控制台错误 / 警告计数和“发给 Claude”（只放进输入行，不按回车）、页面里的应用快捷键和右键菜单、空状态 13E；菜单和对话框打开时用截图代替页面；e2e `browser-panel.spec.ts`。以后再做：截图闪烁 / MutationObserver 范围、本机自签名证书、缩放后的坐标、隐藏时暂停端口扫描、端口出现后自动刷新、闲置页面回收、触摸和移动端 UA、按 cwd 找后台服务的端口
  - [x] 终端里的链接优先在内置浏览器打开（2026-10-18，PRD v1.16）：单击 = 右侧栏浏览器、导航到会话所在 worktree 的页面；⌘ 单击 = 系统浏览器；右键链接 = 在内置浏览器打开 · 用系统浏览器打开 · 复制链接；OSC 8 超链接同样处理，悬停显示真实地址；e2e 在 `browser-panel.spec.ts`。以后再做：设置里改默认打开方式
  - [x] 内置浏览器能登录外部网站（2026-10-18，PRD v1.18）：外部网站共用一个分区（本机 / 局域网仍按 worktree 隔离，跨类跳转换视图）；登录弹窗开成 Wavi 里的小窗口并保留 `window.opener`，⌘W 只关弹窗；页面 UA 去掉 `Electron/…` 和应用名；e2e 用 `--host-resolver-rules` 把 `site.example` 指到本机。真实 Google 登录已验证（第一次弹窗报 Google 400，第二次成功，原因未查明）
  - [x] 手机视口按钮移到浏览器工具栏，端口行只在有端口时出现（2026-10-18，PRD v1.19）；Figma BrowserBar 待同步
  - [x] 终端里的文件路径点开到文件视图预览（2026-10-18，PRD v1.17）：`src/a.ts`、`:行:列`、`#L行`、`(行,列)`、worktree 内的绝对路径，主进程确认存在且在 worktree 里才是链接；单击 = 预览并滚到那一行，⌘ 单击 = 默认编辑器，右键 = 预览 · 用默认编辑器打开 · 在 Finder 中显示 · 复制路径；e2e 在 `right-panel.spec.ts`。以后再做：按 shell 的当前目录（OSC 7）解析相对路径、OSC 8 的 `file://` 链接、目录路径在目录树里展开

## 未开始

### M5 · Git 图谱 + PR 状态 → v0.4.0
完成标准：Figma 04 还原；5000 个提交的仓库首屏 < 300 ms。外部验证到期（2026-11-16）后，按收集到的需求重新排序。
- [x] F6 / F17 Git · 图谱（2026-10-17，Figma 13B / 13H）：lane 算法 `src/shared/git-graph/lanes.ts`（增量分页、默认分支固定在第 0 列、每行向左收拢）、GraphRef 胶囊（本地 / 远程 / worktree + StatusGlyph / tag）、✓ 当前 HEAD、点 worktree 胶囊切会话、全部分支 / 仅 worktree / 隐藏远程分支、只渲染可见行、拉取（fetch，沿用用户的 ssh 配置）、ref 变化自动刷新并保持滚动位置；右键菜单有切换到会话 · 复制 SHA · 复制提交说明；e2e `git-panel.spec.ts`。5000 个提交首屏实测 75–111 ms（`git-panel-perf.spec.ts`）
- [ ] F6 右键：合并到基线 · 基于基线 rebase · 新建 worktree · 删除 worktree（F4 合并面板已有，待接到图谱右键）
- [ ] F6 / F17 Git 后续：每个 worktree 的未提交行 / 脏标记、点提交看详情、聚焦分支高亮、同一仓库的多个 worktree 共用图谱状态、`--no-textconv` 等仓库配置隔离、旧版 git 的 `-z` 兼容、分支 + 未提交合并 diff
- [x] F16 PR / CI 状态（2026-10-20，PRD v1.51，提前于外部验证到期做掉）：只用用户自己的 `gh` 登录，主进程低频查有 upstream 的分支（checks 进行中 1 分钟、打开 3 分钟、其余 10 分钟，失败退避、限流全部暂停 15 分钟）；侧栏会话行和总览 PR 列显示 `#123 ✓` / `#13 草稿 ◌` / `#9 已合并`，会话头没放（Figma 17 没有位置）；没有 gh 时只在“创建 PR”上方给一行提示。CI 失败时“让 agent 修复”把失败的检查名和 `--log-failed` 末尾按 §6.9 引用、放进输入行不按回车。外部来源：竞品（Orca、Superset、Conductor、Claude Code 桌面版、Codex app、Copilot app）都有 PR / CI 闭环，Claude Code 桌面版有 CI 栏，o#9512（应用内看 PR，15 👍）；用户更愿意复用 gh 登录而不是给 GitHub OAuth 大权限。测试：`src/main/pull-requests.test.ts`（假 gh + 临时仓库，真推送到本地 bare 仓库）、`src/shared/pull-requests.test.ts`、e2e `pull-requests.spec.ts`（截图在 `test-results/pull-requests/`）。还没在真实 GitHub 仓库上走一遍创建和修复
- [x] 创建 PR（2026-10-20）：Git · 变更底部的按钮启用——从没推送过的分支先确认再 `git push -u`，然后 `gh pr create`（标题 = 会话名，正文 = 提交说明），在内置浏览器打开；已有打开的 PR 时变成“打开 PR #N”

### M6 · 深化（持续）→ v1.0
完成标准：PRD §1.3 的指标全部达标，没有 P0 / P1 缺陷。
- [x] 会话在应用重启后保留（PTY 守护进程，已在 2b 期间完成）
- [ ] GitHub PR 合并（`gh`；创建已在 M5 做完，2026-10-20）、应用内看 PR 评论（o#9512）
- [x] 文件预览：长行自动换行、Markdown 渲染（2026-10-21，PRD F17 v1.59）：react-markdown + remark-gfm，HTML 经 rehype-raw + rehype-sanitize（GitHub 白名单）；链接打开内置浏览器 / 文件预览 / 标题锚点，标题行切换源码。顺带修了切换文件时短暂显示上一个文件内容的问题。纯逻辑 `markdown-model.ts`（链接解析、不越出 worktree、标题锚点），e2e `right-panel.spec.ts`（截图 `13f-markdown`、`13f-wrap`，两种主题）。Figma 13F 待补渲染态；`npm run dev` 下 worktree 图片因页面不是 file:// 加载不出、显示替代文字，安装版正常（未在真机看过）
- [ ] 导入 Ghostty / iTerm 主题
- [ ] 孤儿 worktree 自动回收
- [x] 总览批量操作（多选后停止、关闭、发送同一条消息）（2026-10-21，随多 agent 第二批的“一题多解 + 广播”提前做完，PRD F9 v1.60）
- [ ] PRD §4 “P2 储备”中的各项

### D · 发布质量（穿插在各批次里）
- [ ] 官网 `site/`（纯静态页面，GSAP 走 CDN）：版式、动效、深浅色和手机宽度已按 Figma「官网 · Website」做完（2026-10-18）；部署移到“外部验证”，英文版排在那之后
- [x] D1 性能基线：10 / 20 个会话的内存、输入延迟、冷启动，8 小时长跑（2026-10-20，PRD §6.12）。外部背景：三家竞品都有内存 / CPU 随时间涨的 issue——o#10928（正常使用中越用越重）、o#19768（主进程每秒漏 26 MB 直到被系统杀掉）、s#3049（渲染进程 60 分钟涨到 3.2 GB 后 GC 卡死）、c#5209（2 GB 涨到 12 GB），Electron 和 xterm.js 被点名；在多 agent 这个定位上，稳定跑 10–20 个会话是前提
  - [x] 8 个会话的第一份数据（2026-10-20，假 agent，M4 Retina，修复图集之后的构建）：每个会话约 4900 行中文回滚、空闲时 Wavi 加守护进程约 1080 MB，输入延迟 p50 / p95 为 13 / 20 ms；7 个会话在后台各输出 40 行/秒时，内存峰值 1123 MB，渲染进程 CPU 6–10%；在正在输出的会话里打字为 29 / 40 ms
  - [x] F20 4 格同时在屏（2026-10-20，`split-latency.spec.ts`，TR_STRESS=1，假 agent 每格 40 行/秒，M4 Retina，WebGL，三次）：只有键盘所在那格安静时 p50 / p95 为 11 / 18–50 ms；其他三格输出时 10–13 / 19–49 ms；四格都在输出时 12–13 / 55–83 ms。p50 达到 PRD F20 的 < 16 ms，p95 有长尾（四个 WebGL 终端同帧重绘），待查
  - [x] 10 / 20 个会话和冷启动（2026-10-20，M4 16 GB，`TR_SCALE=1 npx playwright test e2e/scale.spec.ts`）：假 agent `e2e/scale-agent.mjs` 跑真实的按次 hooks、statusLine 和 transcript，像 agent 一样画标题、工具调用、彩色中文和权限框；项目是带 worktree 的 git 仓库。冷启动（启动到侧栏出现全部会话）0.45–0.72 s，目标 ≤ 2 s。内存（各进程工作集 + 守护进程；括号里是活动监视器口径的 phys_footprint）：10 个会话空闲 668（460）MB、9 个各输出 20 行/秒 570（502）MB、全部输出 617（610）MB；20 个会话 703（409）、609（535）、669（763）MB，目标 < 1.5 GB。输入延迟（按键到显示回显的那一帧）p50 / p95：10 个会话 10 / 18（空闲）、12 / 20（9 个输出）、11 / 19 ms（全部输出）；20 个会话 11 / 18、11 / 20、11 / 20 ms。p50 达到 < 16 ms；p95 多出的 2–4 ms 是“下一帧才显示”，一个会话空闲时也是 18 ms，不随会话数变。19 个会话输出时渲染进程 CPU 1.5%、主进程 0.4%、守护进程 2.8%
  - [x] 修掉的规模问题：隐藏的终端每帧整屏重画（PRD §6.3，`paused-selection.ts`）。修之前 20 个会话里 19 个输出时 p95 65–1632 ms、最长卡 1.8 s，渲染进程 CPU 6.6–11%（8 个会话那份数据里的 6–10% 也是它）；修之后见上
  - [ ] 8 小时长跑（`TR_SCALE_SOAK_MIN=480 … -g soak`，20 个会话按真人节奏循环：20–120 s 一轮、30–300 s 空闲，偶尔权限框和并行子 agent，每 20 s 切换会话、每 10 分钟开一次总览）：三次都在合盖时被结束（55 分钟、3.96 小时、21 分钟）：机器用电池，合盖就睡眠（`caffeinate -s` 只在接电源时有效），系统日志里每次都是睡眠事件之后 50–400 ms，测试启动的应用或守护进程收到 SIGTERM / 退出，没有崩溃报告。复测：20 个会话工作时 SIGTERM 守护进程，应用 0.1 s 内拉起新的、继续运行（但那些会话结束了）。要跑满 8 小时得接电源、开着盖子。最长的 3.96 小时：热身约 1 小时（回滚填满）之后，渲染进程 JS 堆平均 65 MB（+1 MB/h）、主进程 11 MB，不涨；各进程工作集之和平均 1.18 GB，不涨（−98 MB/h，部分被压缩）；守护进程约 160 MB；footprint 在 1.2–1.5 GB 之间来回（拟合 +29 MB/h，噪声大），最高 1.51 GB，大头记在 GPU 进程上。平均 CPU：渲染 0.7%、GPU 0.3%、主进程 0.2%、守护进程 1.3%。没看到泄漏；完整 8 小时还没跑成。长跑现在按进程类型拆 footprint（一次 10 个会话的试跑里 0.71 GB 中 GPU 进程占 0.44 GB），被中断时也写出汇总
- [ ] D1b 渲染包拆分（原在 D1）
- [ ] D2 可访问性：弹窗焦点锁定、状态变化朗读、更明显的焦点框
- [ ] D3 测试：真实 agent 和打包测试做成每晚任务；故障注入测试；去掉固定等待
  - [x] CI 上只在 runner 失败的 3 个 e2e（2026-10-17）：字形采样不再包含提示符行（单行提示符时命令会打在那一行）；持久化测试改用假 `claude`（runner 上没有真 CLI，启动行一闪而过）、窗口尺寸取在 1024×768 屏幕之内
  - [x] CI 上又有 2 个只在 runner 失败的 e2e（2026-10-18）：runner 的 shell 是不支持 bracketed paste 的 bash 3.2，“发到终端”的多行文本被逐行执行——程序没开 bracketed paste 时改为压成一行插入；1024 宽屏上右侧栏是浮层、盖住会话头的 Git 图标，测试改点面板自己的关闭按钮；顺带修了改动后 300 ms 内重新载入会读回旧 workspace.json 的问题（读取前先写盘）
  - [x] `cjk-input.spec.ts` 合并后偶发失败（2026-10-20）：原因在测试回放输入法事件的方式，不在应用代码。回放的按键没被页面处理时会退回 macOS，被本机的输入法（豆包拼音）提前结束组合输入；按键和输入法文字分两次送出时，xterm 的 `setTimeout(0)` 可能先跑。现在两者一起送出，页面把 229 按键标成已处理；被外部打断的那一轮作废重来（最多 5 次），只在干净的一轮上断言；键间的固定 10 ms 改为等待已排队的计时器。`--repeat-each=10` 连跑三轮 390 / 390 通过
  - [x] main 上 CI 从 2026-10-19 起一直红，4 个 e2e 只在 runner 失败（2026-10-20）：都是测试问题，不在应用代码。macOS 在窗口第一次显示时把它塞进屏幕（runner 是 1024×768），在那之前调用的 `setSize(1440, 900)` 会被撤销；显示之后再设，宽度即使超出屏幕也会保留（本机屏幕 1470 宽，所以一直是绿的）。窗口停在 1024 宽时右侧栏是浮层：会话头宽度不变（`session-meta` 的窄会话头）、盖住会话头的视图图标（`right-panel`，偶发，取决于显示和 setSize 谁先）和终端中间（`menu-keys` 点终端中心）；侧栏最多显示 1024 − 560 = 464（`smoke`）。新增 `e2e/launch.ts` 的 `setWindowSize`：等窗口可见再设尺寸，并等页面拿到新宽度，12 个原来直接 `setSize(1440, 900)` 的 spec 都改用它；`smoke` 也用它，并补上窄窗口里侧栏让出主区最小宽度的断言；`menu-keys` 改点终端左上角。把默认窗口临时改成 1024×768 能在本机复现原来的失败；4 个 spec `--repeat-each=5` 180 / 180 通过
  - [x] `browser-panel.spec.ts` 的“隐藏的页面交还键盘”在作者用着电脑时连续失败（2026-10-21）：不是回归，`src/main/browser` 自 v0.3.0 没改过，失败的第一步只是在主进程里对页面调 `focus()` 再读 `isFocused()`。macOS 只在 key 窗口里报告哪个视图有焦点（测试窗口不是 key 时两边都是 false）；原来靠页面的 `focus()` 顺带激活应用，而 macOS 14 起激活只是请求，有人正在别的应用里操作时会被拒绝，于是 5 秒后超时。现在先把应用窗口设为 key（最多等 15 秒），做不到时直接说“macOS kept another app in front”，不再是看不出原因的超时。本机空闲时连跑 3 轮 45 / 45 通过；访达被切到前面时能恢复；窗口隐藏时给出新提示。被拒绝本身没能在本机复现（要有人在别的应用里真的打字，脚本合成输入需要辅助功能权限）
- [ ] D4 安全：CSP 补 `base-uri` / `object-src` / `form-action`；IPC 事件不传整份文件内容
- [ ] D5 自动更新（签名和公证移到“外部验证”，需要 Apple Developer 账号）
- [ ] D6 代码健康：测试钩子不进正式包、清理重复常量和废弃别名

## 已取消

- ~~F1 输入栏~~（v1.2，2026-10-16）：终端就是全部输入面，按键直接进 PTY。
- ~~F3 应用内作答（PromptBar）~~（v1.2）：权限请求和提问只用来标记“等你处理”，在 TUI 里作答。
- ~~渐变 / 图片背景~~（v1.2）：终端底色只跟随浅色 / 深色主题。
- ~~侧栏“等你处理”置顶队列~~（v1.1）：会让会话离开所属项目、在列表里跳来跳去；改由总览、⌘J、通知和 Dock 角标提示。

## 待作者手动确认

2026-10-20 能自动化的已写成 e2e；剩下的整理成人工清单 A–E，一次走完约 9 分钟，清单在作者的「Wavi 待办清单与优先级」文档里。

- [x] 在应用里运行 `vim`、`htop`、`less`（2026-10-20，`tui-apps.spec.ts`：vim、less、top 通过；本机没装 htop，那个用例自动跳过）
- [ ] 真实桌面：关闭按钮隐藏窗口、Dock 恢复；⌘Q 后 agent 继续运行；⌥⌘Q 弹出确认。逻辑已由 `lifecycle`、`quit-keeps-agents`、`menu-keys` 覆盖，剩清单 B：全屏下关闭、原生确认框的样子
- [ ] 系统通知、点击通知跳转、Dock 角标。主进程的真实链路已由 `notifications.spec.ts` 覆盖，剩清单 D：横幅的样子和通知权限
- [ ] 侧栏毛玻璃开 / 关的观感（只能人工，清单 E）
- [ ] 真实键盘按菜单里的快捷键（⌘N、⌘\、⌘F、⌘J 等）只触发一次（菜单和渲染进程都接这些键，重复的一次会被丢掉）。`menu-keys.spec.ts` 已覆盖，剩清单 C：用真键盘按 30 秒
- [ ] 下载后 Gatekeeper 提示与 `xattr -cr` 流程（清单 A）。结果决定 README 里“仍要打开”那句备选说法对不对
- [ ] Codex 在真实模型下的表现（`TR_E2E_AGENTS=codex TR_E2E_CODEX_REAL=1`）。用例已有，会花额度，跑之前要作者同意
- [ ] F19 真机：从 Finder 把一张图和一个文件拖进 Claude 会话、再拖进 Codex 会话；⌃⇧⌘4 截到剪贴板后 ⌘V；⌘⇧4 截图后直接拖角落的缩略图（应放进 `wavi/attachments/drop-*` 下的副本）。应各出 `[Image #N]`，文件保留成路径
- [ ] 额度真的用完时走一遍“恢复后发送‘继续’”（要真实账号用完，跑之前要作者同意）：Claude 订阅账号上 2.1.304 的 `autoContinueAtUsageLimit` 倒计时和 `/rate-limit-options` 菜单是否如二进制所读（PRD §6.6）、Wavi 遇到时是否不发；Codex 用 ChatGPT 账号时 `usage_limit_reached` 的 rollout 和换模型弹窗（本机是 API key，只用模拟模型测过）
- [ ] 连续自用一周，状态没有卡死（2026-10-20 修了一个必现的卡死：⌘Q 后重开；同日按模拟压测修了多个对话框、子 agent、后台 agent 下的错状态，PRD §3.1）
- [ ] 真实 Claude Code 下核对模拟器的几条假设（会花额度，跑之前要作者同意）：一批里两个新域名的 WebFetch 同时请求权限、依次回答；前台 Task 的子 agent 请求权限时标题是否停在 `✳`；后台 agent 在一轮结束后请求权限；agent teams 成员的 `worker_permission_prompt`，以及 tmux / iTerm 分屏模式的成员进程的 hook 会不会记到 lead 的会话上

## 已知问题

- 没有 hook 时（Codex 的 hook 信任没拿到、Claude 的 hooks 不工作）API 报错看起来和一轮正常结束一样（都是空闲）。
- 20 个会话都填满 1 万行回滚时 footprint 在 1.2–1.5 GB，贴着 PRD §1.3 的 1.5 GB，大头记在 GPU 进程上（D1）。要省可以从回滚长度和隐藏终端的 GPU 资源入手。
- 隐藏终端不重画的补丁（`paused-selection.ts`）读 xterm RenderService 的三个内部字段，升级 xterm 时要复测（`TR_SCALE=1 TR_SCALE_PROFILE=1 … e2e/scale.spec.ts`）。
- 状态规则依赖 Claude Code 2.1.304 的标题：有对话框时 `✳`、在跑时 `◐` / `◑`（PRD §6.6）。CLI 改了要用 `scripts/spikes/` 和模拟器复测。
- 用户自己在 alias 里追加 `--settings` 会让我们的 hooks 失效（只认最后一个）。
- Codex 只在第一条 prompt 时才发 SessionStart，也没有 SessionEnd / Interrupt 事件；它的启动和中断靠屏幕与标题判断。
- 启动标记（OSC 7771）没有鉴权，恶意输出最多伪造一张“已退出”卡片。
- PTY 守护进程不处理截在 attach 点上的半个转义序列（会显示成一次文本）。
- 应用没开着时注销或重启，守护进程得不到通知：没连着应用的会话，最后 30 s 内变了的屏幕不写盘（唯一一次实测的真实重启里，守护进程没收到能记下来的 SIGTERM）。
- 机器负载很高时，几个依赖时序的 e2e 会偶发失败（D3）。跑 e2e 时有人在这台机器上打字，键盘输入会进到测试窗口里，这种情况测试兜不住。
- ⌘B / ⇧⌘B / ⇧⌘M 按物理键位（`e.code`）判断，其余快捷键按字符（`e.key`），Dvorak、AZERTY 等布局下会错位。
- 输入法候选窗开着时，只由菜单处理的快捷键（⌘N、⌘O、⌘W、⌘F、⌘,、⌘+ / ⌘- / ⌘0）可能不起作用。这是从 Chromium 源码推断的，等中文输入真机清单第 7 步确认。
- 重开应用后，接回的 agent 在下一个 hook 到来前显示“空闲”（状态不跨重启保存）。
- “恢复后发送‘继续’”的预约只在窗口页面里：⌘Q、重启应用或重新载入后就没了，额度恢复时不会发送（关窗口只是隐藏，不影响）。
- WebGL 图集保护每次重建会卡一帧（80–110 ms），而且读的是 addon 的内部字段；窗口重新获得焦点时原有的“原地清空图集”修不好已经合并的图集（有保护之后不会再合并）。
- `PRODUCT.md` 还写着已取消的输入栏和一键作答；CHANGELOG 0.3.0 里“额度要等第一次回复后才出现”在 PRD v1.38 之后已经不准确。

## 风险与待定项

| 风险 / 待定项 | 应对 | 状态 |
|---|---|---|
| Claude / Codex 新版本改变 hook 或 TUI 行为 | 按 CLI 版本区分策略；保留实测脚本 `scripts/spikes/` 和 fixtures 以便复测 | 持续 |
| hook 丢事件导致状态卡死 | 进程存活检查、超时降级、标题和屏幕兜底、`idle_prompt`、守护进程补放；会话模拟器回放（丢 5% hook 时显示错误最长 7 s） | 已处理，模拟压测 + 自用验证 |
| Codex hook 信任机制 | 用 `-c hooks.state` 按次固定我们自己的 hash | 已决定（PRD §6.7） |
| Apple Developer 账号 | 已到位，v0.4.0 起发布版签名并公证 | 已解决（2026-10-20） |
| xterm 7.0 正式版 | 发布后升级 xterm 和全部 addon（含守护进程用的 headless），删掉 `atlas-guard.ts`（PRD §6.3） | 等上游 |
| 楔子假设不成立（中文开发者没有信号） | 外部验证开始后第 4 周按 PRD §1.5 换楔子，或回到个人工具 | 外部验证延后到 M5 / M6 之后 |
| `claude -p` 被单独计费（“programmatic usage”） | 两份调研的说法不一致：一说从 2026-06-15 起按 programmatic 计费，一说宣布后又暂停了。F13 后台审阅用的是 `claude -p`；额度轮询不发模型请求，应该不受影响。先查清官方现状，再决定审阅要不要在设置里写明 | 待查 |
| 原生产品吸收“开会话、看状态” | 不在这一段上竞争：做跨 Claude / Codex 的审阅、验证、合并（PRD §1.2 v1.48） | 已决定 |
| 许可证合规 | 借用的代码逐文件登记在 `THIRD_PARTY_NOTICES.md` | 持续 |

## 设计稿与里程碑

| Figma 屏幕 | 里程碑 | 状态 |
|---|---|---|
| 01 运行中 | M1 + M2 | 已还原 |
| 02 等你处理 | M2 | 部分还原（PromptBar 已取消） |
| 03 变更审阅 | M4 | 未开始 |
| 04 Git 图谱 | M5 | 未开始 |
| 05 合并预检 · 冲突 | M4 | 未开始 |
| 06 新任务 | M4 | 已被 15 取代 |
| 07 设置 · 外观 | M3 | 已还原 |
| 08 浅色模式 | M3 | 已还原 |
| 09 侧栏 · 项目与会话入口 | 2b | 已还原 |
| 10 会话生命周期 | 2a | 已还原（卡片在 v1.2 去掉） |
| 11 v2 总览 | 2b | 已实现，待验收 |
| 12 会话头：ctx % · todo · 端口 · PR | M4 并行 / M5 | 已被 17 取代；PR 标签按 F16 做在侧栏和总览（17 的会话头没有位置），Figma 待补 |
| 17 会话指标（context · todo · 额度）+ F5 并排 diff | M4 | 已实现，待验收（2026-10-19） |
| 18 context 与额度可视化 | M4 | 已实现，待验收（2026-10-19） |
| 13 右侧栏：浏览器 · Git · Worktree · 文件 | M4 | 已设计，待作者确认 |
| 15 新建会话（⌘N，玻璃材质） | M4 | 已实现，待验收（2026-10-18） |
| 21 主区分屏（F20；Figma 的 20 节是 F19） | 多 agent 第二批 | 已实现，待验收（2026-10-20） |
| 冲突雷达：总览冲突列、浮层标题栏、Worktree 行和详情、“让 agent rebase”（还没有 Figma 节） | 多 agent 第二批 | 未设计，照现有样式实现（2026-10-21），待补 Figma |
| 一题多解 + 广播：新建会话面板「多个」、总览的一题多解组行、浮层对比条、合并后「归档其余 N 份」、批量条（还没有 Figma 节） | 多 agent 第二批 | 未设计，照 15 / 11 v2 现有样式实现（2026-10-21），待补 Figma |
