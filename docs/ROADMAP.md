# Wavi 路线图与进度

> 最后更新：2026-10-30
> 本文只记**做到哪了**：已完成什么、正在做什么、还没做什么。产品最终长什么样写在 [PRD](PRD.md)。
> 维护规则：完成、新增、取消一项时直接改这里（勾选、移动或划掉），更新顶部日期；不要另建任务单、验收记录或计划文档。验收结论写进对应里程碑下面，几行即可。

标记：`[x]` 已完成 · `[ ]` 未完成 · ~~划线~~ 已取消（原因写在后面）。编号 F1–F20 见 PRD §4；A / B / D 是第二阶段的条目编号。

## 当前位置

- 2026-10-30：出口预检少跑 gh 和 git（代码审核）：合并方式查询失败或没有可用结果时也缓存 1 分钟，不再每次 git 变化都调 `gh api graphql`；`workInBase` 和其余预检并行（`src/main/ship.ts`，`ship.test.ts`）。PRD §6 记下按内容判断已合并的冲突边界。
- 2026-10-30：修代码审核的两处问题（PRD v1.106）：squash 后分支已推送过（有 upstream 或远程同名分支）时不移到 squash 提交上，免得和远程分叉（`moveBranchTo`，`git-merge.test.ts`）；分支同步遇到分离 HEAD 不再把短提交号写进 worktree 记录（`branchesOf`，`model.test.ts`），归档恢复不会新建以短提交号命名的分支。
- 2026-10-30：B27「合并到 main 并推送」的合并方式跟随仓库（PRD v1.105）进行中：已完成主进程和共享层——出口预检带回 GitHub 仓库允许的合并方式和默认方式（`repoMergeMethods` / `REPO_MERGE_QUERY`，`src/main/ship.ts` 的 `repoMergeSettings()`），squash 后分支移到 squash 提交上（`reset --keep`），rebase 不再被未跟踪文件挡住；`git-merge.test.ts`、`ship.test.ts`（三种方式各合并并推送一次、squash 后不能再合并）、`pull-requests.test.ts`。Figma 第 43 节（`688:32000`）画了「合并方式」一行的状态，等作者定稿后再做渲染层（出口区「合并方式」、记住的方式、自动修复和合并面板用同一个解析结果、步骤标签）。
- 2026-10-30：F21 重做的实测做完 5 项（PRD v1.104）：`wavi` 改为用文件和 Wavi 通信（Codex 默认沙箱拦 unix socket），Pi 能走原生通道；OpenCode 没装、未测。
- 2026-10-30：F21 派活与回报定下重做方案（PRD v1.103）：调研了 17 个同类产品、13 家 CLI 的原生能力和用户 issue；还没实测、没出 Figma、没写代码，见第三批「F21 重做」。
- 2026-10-30：修 B26：Git · 图谱一个提交上有多个 ref 胶囊、右侧栏变窄时，胶囊不再一起缩成只剩图标的小框；放不下的整个隐藏，留下的保持完整，提交说明紧跟其后。静态页用真实 CSS 在 330–1800 宽来回切实测；还没在 app 里看过。
- 2026-10-30：修 B25（PRD v1.101）：squash 合并到 main 之后，Git · 变更底部不再出「合并到 main 并推送」「创建 PR」，再合并一次也被主进程挡住，不会让 agent 重写提交说明、不会往 main 写空提交。`workInBase`（`src/main/git-merge.ts`）+ 预检的 `merged`；`ship.test.ts`（合并两次，第二次被挡、main 和 origin 不动）、`exit-model.test.ts`。
- 2026-10-30：全屏时侧栏和会话头的字不再分灰度（PRD v1.102，Figma 42C）：全部主色、次要的字小一号（作者看过后去掉了稿里的暗晕），会话头和侧栏顶栏从 44 收到 36（窗口和全屏一致，红绿灯下移到 y=11），卡片下沿和侧栏「设置」一行的下沿对齐（离底边 12），修「全屏 + 深色 + 湖岸背景时文字看不清」。构建版全屏截图核对过深色湖岸、浅色夜火；额度条没有数据，没截到。
- 2026-10-30：全屏程序自己铺的底色延伸到终端内边距（PRD v1.100）：Grok 这类给每个格子填色的 TUI 不再被一圈主题底色围着；四条边颜色不一致、或有默认背景时保持主题色。`edge-fill.ts` + 单测；app 内实测深色 / 半透明 / 浅色和真实 grok，内边距、右侧余量与格子同色，退出后恢复。顺带修 B24（常驻滚动条时终端右边的原生轨道）。
- 2026-10-30：修复 v0.12.0 侧栏主目录会话没有第三行（分支）：主目录的 worktree 记录从 M1 起分支一直是空的。现在启动、加项目 / worktree、窗口获得焦点、git 的 worktree / 分支文件变化时读一次 `git worktree list`，把分支写回记录，会话头也显示主目录的分支；总览主目录仍只写项目名。仓库 watch 改成窗口内计数，Worktree 视图关掉不再停掉侧栏的同步。e2e `branch-sync.spec.ts`（启动显示 main、`git switch` 后跟着变、开关 Worktree 视图后仍跟着变）。
- 2026-10-29：hook 的 `tool_input` / `tool_response` 在守护进程转发前裁掉（Read 的整份文件、Bash 的整段输出、Write / Edit 的文件内容不再和终端输出挤同一条 socket），守护进程 socket 的分行改成线性（见 D1）。
- 2026-10-29：派活确认不再盖住窗口：派活会话变“等你处理”，确认条在它的终端下方；侧栏子会话用细线连到派活会话（PRD v1.99，Figma 40）。还没在作者的机器上用真 agent 派过。
- 2026-10-29：**启动画面和欢迎页入场**（PRD v1.98，Figma 39G–39J）：点开应用不再先黑一下，第一帧就有卡片，细点聚成标志；欢迎页的标志转正、向左滑并带出问候语。首次可交互在测量噪声内（新旧交替测三轮，中位数 307 / 305 / 254 → 299 / 331 / 271 ms），首帧 328–384 → 140–176 ms。还没在作者的机器和打包后的 app 上看过。
- 2026-10-29：全屏时外壳自带光场（配色取自作者的配图底托，10 种 + 自动），设置 · 外观 加「全屏背景」（PRD v1.97，Figma 38）。副窗口全屏还没接。
- 2026-10-29：修复启动后液态玻璃不透、切一次主题才透出来：等窗口显示后再挂玻璃（PRD §5）。还没在作者的机器上确认。
- 2026-10-29：分屏时每一格的会话下面各有一块水滴，新开一格滴下来、关掉收缩消失、换会话流过去（PRD v1.96，Figma 37B）；只在别的窗口显示的会话仍是 1px 描边。
- 2026-10-29：选中会话是一块在行间流动的「水滴」玻璃（两根弹簧，拉长、压扁再回弹，PRD v1.94，Figma 37）；外壳在 macOS 26 上换成系统的 Liquid Glass（`NSGlassEffectView`，PRD v1.95），水滴的宽度和会话行对齐。还没在打包后的 app（`npm run build` / dist）里验证 `.node` 能从 asar 外加载。
- 2026-10-29：侧栏底部加「更新」（版本号和检查更新的小浮窗），设置去掉「关于」页，设置各页内容居中（PRD v1.93，Figma 36E–36I）。
- 2026-10-29：设置 · 智能体 每家前面加单色黑白标志，名字和安装命令从标志之后开始；「复制安装命令」的文字和版本、状态右对齐（PRD v1.92，Figma 35A / 35B）。
- 2026-10-29：**侧栏会话行和项目头重排**（PRD v1.91，Figma 34P–34R）：图形都在左边一列、文字从同一条线起；会话一行一件事（标题 · 时间 / 在做什么 / 分支 · agent 标志），没内容的行不画，侧栏不再写 `+N −M`，项目头只在折叠时写数量；StatusGlyph 换成 L3（弧、点、勾、三角、环、短横）；agent 标志改单色黑白。e2e 全量 273 个通过，测量：文字线 40、图形中心 24、时间和标志右边 16（侧栏 204 / 264）。
- 2026-10-29：设置 · 额度 的 agent 图标改到「额度」「提醒」的左边线上，名字和窗口名从图标之后开始（PRD v1.90，Figma 33I / 33J）。
- 2026-10-28：**全局额度**（PRD v1.89，Figma 33）：侧栏「设置」上方的「额度」（⇧⌘U）打开设置 · 额度，列出每个装了的 agent 的额度、最紧的在前，没有数字时写原因；额度提醒挪到这一页；「刚好用完」的标记从竖线改成条的底层（会话头、浮层、这一页一起改）。还没做：Codex chatgpt 登录下 `planType` 没有实测；通知点击仍打开总览的浮层，没改成打开这一页。
- 2026-10-28：Git · 变更 按 Figma 29R 重排（PRD v1.86）：长 diff 的文件行吸顶可收起、「全部收起」、审阅块和出口区的层级与对齐、方角开关；没有 P0 / P1 的审阅默认勾选最高一级。
- 2026-10-27：右侧栏拖窄时，上方的 context / 额度不再压到视图图标上（窄于 464 收起额度，窄于 408 收起 context，PRD v1.84）。
- 2026-10-27：**合入链路重做**（PRD v1.78，Figma 29）：三个检查点（看 diff、可选审阅、CI）、两个出口（合并到 main 并推送 / 创建 PR）；文字和修代码交给会话里的 agent，提交 / 合并 / 推送 / gh 由 Wavi 执行并把关。见下面“合入链路”。
- 将发布 **v0.12.0**（2026-10-29：macOS 26 上外壳换成系统的 Liquid Glass；侧栏会话行重排、选中是一块流动的玻璃水滴；侧栏「更新」；全屏背景；启动画面；派活确认挂在派活会话的终端下面、Esc 撤回；hook 大载荷裁剪、快照异步、隐藏会话限流，PRD v1.90–v1.99）。之前是 **v0.11.0**（2026-10-28：设置 · 额度 集中显示每个 agent 的套餐额度（⇧⌘U）；Git · 变更 按 Figma 29R 重排，文件行吸顶可收起；应用内菜单去分隔线；光标靠右时输入中文不再让终端横移，PRD v1.85–v1.89）。之前是 **v0.10.0**（2026-10-27：合入链路重做，Git · 变更 一处完成看 diff、审阅、合并到 main 并推送 / 创建 PR，CI 回到原会话并由 agent 修；半透明终端改用 WebGL、中文对齐网格；新 logo，PRD v1.78–v1.84）。之前是 **v0.9.0**（2026-10-26：窗口外壳固定成玻璃，侧栏和右侧栏有开合动效，右侧栏打开时会话工具留在窗口最右，PRD v1.73 / v1.74，Figma 28）。之前是 **v0.8.1**（2026-10-26：主目录作为会话文件夹时不再触发“Wavi 想访问桌面”，PRD v1.72）、 **v0.8.0**（2026-10-25：终端底色可以改、导入 Ghostty / iTerm 主题，PRD v1.71）、**v0.7.0**（2026-10-25：19 家 agent CLI 原生启动、一个面板完成提交 / 推送 / PR 和 AI 写、同任务多解、侧栏显示 agent 图标和分支、设置去分隔线、浮层精简）。之前是 **v0.6.0**（2026-10-22：派活与回报，任何一家 agent 派给任何一家、结果自动回到派活方；PR 闭环到合并：创建 PR 面板、PR 评论回到变更视图、在合并面板合并 GitHub PR、自动修复和通过后合并；审阅结果存盘和另一家来审。之前是 v0.5.0，2026-10-21：多 agent 第二批——这一轮跑过哪些检查、冲突雷达、一题多解 + 总览批量操作、多窗口；文件预览换行和 Markdown；状态准确性、隐藏终端不再重画、守护进程 SIGTERM 修复）。
- 2026-10-27：换新 logo（两条交织的环，米白底；PRD v1.77，Figma Logo 页 `Logo/交织`）：应用图标、官网 favicon、空状态问候图标已换；官网首屏线屏图形（`site/src/assets/orbit.svg`）仍是旧轨道，待定。
- 2026-10-25：侧栏会话行多一行「agent 图标 · 分支」，context 和额度浮层只留数字（PRD v1.70，Figma 27）已完成；Claude 的 diff 默认展开、没有只折叠 diff 的设置（只有 `viewMode: focus`，会同时收起所有中途输出）；作者试过后定**不做**设置里的收起开关（Figma 27E 已标取消），用户要的话在自己的终端里用 `--settings '{"viewMode":"focus"}'`。
- 2026-10-24：原生适配更多 agent（第 7 项 ①②，19 家，PRD §6.15）和设置去分隔线完成；一题多解改从对话里发起（方案 A / B 待作者定）。
- 2026-10-24：读完 T3 Code 后定下要借鉴的 7 项（PRD v1.68），见下面“进行中：借鉴 T3 Code”；先做一键提交 / 推送 / PR。
- 下一步（2026-10-21 改）：**外部验证延后到 M5 / M6 之后**（PRD §1.5 v1.55），作者判断产品还不够成熟。多 agent 第二批已全部完成（2026-10-21，v0.5.0）；现在继续做第三批（F21 派活与回报已完成，PRD v1.67）和 M5；分发里剩下的 brew、仓库改名、Discussions 和用户群，以及找人试用，都等那时再开始。
- 2026-10-21：定下 **PR 闭环做到 L3**（PRD F16 v1.63），排在第三批之前，见下面“进行中：多 agent”的“PR 闭环”。
- 2026-10-20：定下多 agent 的方向——一个人消化多个 agent 的产出（PRD §1.2 v1.48），排期见下面“进行中：多 agent”；第一批三项已全部合进 main（2026-10-21：额度恢复和 F16 在 v0.4.0 里，状态准确性、规模基线和守护进程 SIGTERM 修复在 main 上，等下一个版本）。
- 2026-10-20：P0 里能交给 agent 的几项已合进 main（中文输入和链接、WebGL 中文乱码、手动确认项自动化、README 和 issue 表单、官网）。剩下的都要作者动手：Apple Developer 账号、推送 main 并开启 Pages、仓库改名、Discussions 和用户群，以及两份人工清单（清单在作者的「Wavi 待办清单与优先级」文档里）。

## 暂停：外部验证（原定 2026-10-19 → 2026-11-16，延后到 M5 / M6 之后，PRD §1.5 v1.55）

目标、指标和需求来源见 PRD §1.5。分发排在新功能前面；这 4 周新开的功能需求都要写明外部来源。

分发（先做）：
- [x] Apple Developer 账号 → Developer ID 签名和公证，下载后不再需要 `xattr -cr`（2026-10-20 流水线接通，v0.3.1-rc.1 试跑、v0.4.0 正式发布；自动更新仍留在 D5）
- [ ] Homebrew：自己的 tap，`brew install --cask` 一行装好。放在公证之后做，因为未公证的 app 经 brew 装上同样会被 Gatekeeper 拦
- [x] 官网 `site/` 部署到 GitHub Pages（2026-10-21 推送 main 后自动部署，https://meloer101.github.io/terminal-reborn/ ；英文版不在这一轮里）；2026-10-21 起 `site/` 是 Astro 项目，Pages 工作流先构建再发布，同一份站点也部署到 Vercel（项目根目录 `site/`，见 `site/vercel.json`）
- [x] README 按 v0.3.0 重写，中文在前，加“Wavi 不会做的事”四条（2026-10-20）
- [x] README 改为英文在前（`README.md`），中文另成 `README.zh-CN.md`（2026-10-24，跟随 PRD v1.62 主要市场改为海外）：横幅、徽章、深浅两套真实应用截图（`<picture>`）、官网的比较图和流程图，`docs/assets/readme/`；截图用 `npm run readme:shots` 重拍（演示仓库 + e2e 夹具 + 一个真实 Claude Code 会话，`scripts/readme-shots/`）。同日在 GitHub 上补了 20 个 topic、改了简介、上传了 social preview 图
- [x] 发布视频三部（2026-10-22，`launch-videos/`，HyperFrames 项目，三条故事线见 `launch-videos/STORYLINES.md`）：A「等你的那一个」主发布片 29 s、B「十个问号」X 预告 22.5 s、C「一个任务，三份答案」功能片 31.5 s；都是 1.5 倍速、英文、同一首 CC BY 配乐（smilingcynic「do robots have a god?」，发布时要署名），关键动作卡在 120 BPM 的拍点上，响度 −15 LUFS。还没做：作者试听确认配乐、中文版（换变量和真实中文界面文案）、发布
- [ ] GitHub 仓库改名为 `wavi`（原在“待作者手动确认”）：链接改动已备好，在分支 `claude/repo-storefront-01d834` 的 `e2acf43`（`package.json` 的 `repository` / `homepage`、README、CHANGELOG、打包和发布配置），作者在 GitHub 改名之后再合并；官网改 `site/index.html` 里那一处。已装 v0.3.0 的用户要靠 GitHub 的改名重定向收到新版本提示，所以 meloer101 下以后不能再建 `terminal-reborn`
- [x] issue 表单：bug 报告和功能建议，功能建议必填“现在怎么绕过去”（2026-10-20，`.github/ISSUE_TEMPLATE/`）
- [ ] Discussions 和用户群：作者开启 Discussions、建好群后，把链接填进 `.github/ISSUE_TEMPLATE/config.yml`，并加到两份 README 顶部的链接行和「Development / 开发」里的 issue 那句旁边

楔子必须先过的一关：
- [ ] 搜狗输入法、豆包输入法和系统拼音下的中文输入（原在“待作者手动确认”）。Orca 的 issue 里输入法吞字、重复上屏、选字被清掉这类问题反复出现，Wavi 在这里不能出错。自动化部分已完成（见下面“这期间修好的”）；还差真机清单 10 步，系统拼音、搜狗、豆包各走一遍

找人、收需求：
- [ ] 在中文开发者社区（V2EX、即刻、Linux.do 等）找同时跑多个 agent 的人，目标 10 个
- [ ] 5 次观察式试用（PRD §1.5），每次的卡点记进下面的“外部需求”
- [x] 竞品 issue 调研（2026-10-20）：三家共约 1.5 万个 issue（Orca 8,490、cmux 4,980、Superset 1,514）。结论：中文开发者有真实需求，但 Orca 已经在做（中文 README、微信群、中文界面），输入法正确只是入场条件；能拉开差距的是原生中文文案、多账号 / 第三方端点、多会话下的渲染稳定性。结果排进下面的“外部需求”
- [ ] 作者自己的三种来源（PRD §1.5）：离开日志、并行数翻倍跑一周、拿 Orca 和 T3 Code 各当主力用 3 天再切回来

这期间修好的（2026-10-20，都来自竞品 issue 或自动化检查）：
- [x] 中文输入和链接：网址和文件路径碰到中文、全角标点就截断（o#30213）；全角标点被打成半角（o#6147）；双空格自动句号；输入法组合中按 Enter / Esc 误触发终端查找、设置里的字体搜索、新建会话面板等（o#17820 一类）。e2e `cjk-input.spec.ts`，单元测试 `links` / `file-links` / `ime` / `keymap`。取舍：路径里直接带中文的网址（如 `/wiki/中文`）会在 `/wiki/` 处截断
- [x] 8 个中文会话下的 WebGL 乱码（s#3572，上游修复 xterm.js#5883 在 7.0.0）：v0.3.0 确实会在字形图集合并后叠字、错字；`atlas-guard.ts` 让图集永远不合并（见 PRD §6.3）。压测 `TR_STRESS=1 npx playwright test e2e/webgl-cjk-stress.spec.ts`，修复前 56 次检查 34 次画错，修复后 0 次
- [x] 和 CC Switch 共存：Claude 被指到第三方端点（settings.json 的 `ANTHROPIC_BASE_URL`、Bedrock / Vertex）或 Codex 用非 `openai` 的 provider 时，会话头不再显示官方账号的额度，token 不计入份额，也不让账号算“在用”（PRD v1.46）。之前同时有官方登录的用户会在 Kimi 会话上看到“Claude 5h 12%”。单元测试 `bridge` / `server`（真实中继脚本）/ `codex-usage` / `transcript-meter`，e2e `session-meta` 新增一条（去掉渲染端的判断它会失败）
- [x] 守护进程收到 SIGTERM 不再结束全部会话（2026-10-21，PRD §6.8 v1.54；来自作者日志里的 3 次和长跑测试）：查证是停掉一棵进程树时连带发来的（Claude 桌面版退出时停掉开着 `npm run dev` 的后台任务，守护进程当时是应用的子进程），不是注销。守护进程改为启动即被 launchd 收养，SIGTERM 只写盘、照常运行；main 报告注销 / 重启 / 关机后才结束会话。单元测试 `sigterm.test.ts`、`daemon-client.test.ts`，e2e `pty-daemon.spec.ts`（父进程是 launchd；SIGTERM 后同一个 shell 还在，重开接回；报告关机后 SIGTERM 结束它们）
- [x] ⌘Q 后重开，守护进程保住的 agent 状态不再卡在“空闲”；弹窗里用真键盘按 ⌘F 不再在弹窗背后打开查找栏。新 e2e：`tui-apps`、`menu-keys`、`quit-keeps-agents`、`notifications`，另加随机事件序列下状态不卡死的性质测试
- [x] 切换会话和右侧栏抽屉结束时终端闪一帧空白（2026-10-27，PRD §6.3）：rAF 里重载 WebGL 或改 canvas 尺寸，重画排到下一帧；addon 还会在 ResizeObserver 里把 canvas 清空。显示改到绘制前，抽屉结束时同步 fit，清空之后立刻补画。e2e `terminal-flicker.spec.ts`，修复前 10 个空白帧，修复后 0
- [x] 半透明终端改用 WebGL（2026-10-27，PRD v1.81 / §6.3）：给 addon-webgl 打补丁（`patches/`、`postinstall`）修掉斜体 / 暗淡格子后的不透明矩形（xterm.js#6116）和底色叠画，半透明终端不再强制 DOM 渲染器、中文回到逐字按网格绘制；DOM 只作回退。e2e `webgl-translucent.spec.ts`
- [x] 半透明终端里中文行超出网格（2026-10-27，PRD §6.3）：DOM 渲染器量字宽时 Chromium 的 `text-spacing-trim` 把连写的全角标点压成半宽，每个单独的 ，；。 多画约 0.8 格，Claude Code 高亮块右边参差、行尾的字被裁半个。改为 `space-all`，行回到按网格裁切。e2e `cjk-dom-width.spec.ts`，修复前一行超出 2.4 格，修复后 0
- [x] 依赖和构建缓存目录的写入不再触发 git 重扫（2026-10-27，PRD F17）：右侧栏开着文件或 Git 视图时，agent 跑 `npm install`、dev server 重建写 `node_modules` / `.next` 等，原来每 250 ms 一次 `git status` + `ls-files`，Git 视图每秒一套约 8 个 git。现在这些目录只刷新已展开的文件夹，状态、文件列表和变更不重读。单元测试 `worktree-files.test.ts`
- [x] 侧栏和终端容器不再随任意会话的 hook 事件整体重渲染（2026-10-27）：`SessionRow` 按画出来的内容比较（`sameRow`），`TerminalPane` 按自己的 props 比较（`rect` 按值）。单元测试 `sidebar/model.test.ts`
- [x] e2e 不再留下守护进程（2026-10-27）：守护进程按设计忽略普通 SIGTERM（PRD §6.8），`scale.spec.ts` 和打包测试却用 SIGTERM 清理，机器上积了跑了 6–8 天的守护进程和 agent。改用 SIGKILL（`e2e/daemons.ts`），并在整轮结束时结束本轮各 profile 下还活着的守护进程（`e2e/global-setup.ts`，只碰本轮的 profile）。`pty-daemon.spec.ts` 在负载下丢掉开头几个字（点击时 xterm 还没打开，键盘没进终端），改为等终端拿到焦点、shell 画出提示符再打字：8 路并行 16/16

外部需求（每条写明来源；o = stablyai/orca，c = manaflow-ai/cmux，s = superset-sh/superset，cc = anthropics/claude-code，cx = openai/codex）：
- [ ] 国产套餐（GLM、MiniMax、Kimi）的额度显示。o#18506、o#21757。现在走第三方端点的会话只是不显示额度（v1.46）
- [x] 状态在 Auto mode、subagent、后台任务下的长时压测，顺带修“两个同时确认的工具调用互相顶替”（2026-10-20，PRD v1.52）。c#1027（44 👍：Running / Needs Input 时对时错）、c#2322（22 👍：通知时快时慢）、o#13600（Codex 自动批准后仍提示需要处理）。先核对了 Claude Code 2.1.304 二进制（`agent_id`、`background_tasks`、拒绝不发 PostToolUse、标题 `✳` = 有对话框，PRD §6.6），再按它写了会话模拟器 `src/shared/agent-sim.ts`，回放进状态机对照真实状态（`src/main/hooks/status-sim.test.ts`）。改动前：Claude 48 小时模拟里显示错误最长 266 s、超过 1 s 的错误占 5.5% 的时间，丢 5% hook 时最长 230 s，Codex 最长 39.5 s——主要是两个对话框互相顶替、子 agent 的调用把“等你处理 / 已完成”改回运行中、批准后工具在跑却还显示等你处理、空闲时 15 s 才检查一次。改后：每个对话框一个待确认项、子 agent 只算它的对话框、`idle_prompt` / 对话框后标题转动 / 屏幕上的对话框参与自愈、需要时立刻改用 1 s 检查（PRD §3.1）；最长 7 s、0.6%，丢 5% hook 时最长 7 s，Codex 最长 4.5 s。Claude 的 PermissionRequest 只在真要问人时触发（Auto mode 放行的不触发），所以 o#13600 那种误报在 Claude 上不会出现；Codex 的“Approve for me”没在真 CLI 上验证。测试：`status-sim.test.ts`（含丢 hook、完全没有 hook）、`session-state-machine.test.ts`（600 段随机序列：等你处理 ⇔ 有待确认项）、`normalize.test.ts`，e2e `asks.spec.ts`（真实 hook 链路），可选的 `TR_STATUS_STRESS=1 … e2e/status-stress.spec.ts`（假 agent 在应用里回放、对照侧栏）。真 CLI 下的并行对话框、后台 agent 请求权限和 agent teams 没跑（花额度，列在“待作者手动确认”）
- [x] 把文件和图片拖进或粘贴进运行中的会话（2026-10-20，PRD F19）：拖到终端上（Finder 或右侧栏「文件」视图）、⌘V 粘贴截图、会话头的回形针（文件和文件夹），都把转义后的路径放进输入行，agent 自己把图片变成附件。c#3435（22 👍）、o#15377。e2e `attachments.spec.ts`；从 Finder 真实拖入还没在真机上走一遍（拖入用的 `pathForFile` 和欢迎页拖文件夹是同一个）
- [x] 套餐额度用完后，恢复时继续（2026-10-20，PRD F11 v1.50）：会话因额度用完停下时，会话头（用完的 UsageChip 之后）和总览行写何时恢复，并给「恢复后发送“继续”」；点了才预约，按钮改写发送时间，再点取消。到点先复查账号额度（还在 100% 就顺延到新的重置时间），再看屏幕：有选择框（Claude 的 `/rate-limit-options`、Codex 的换模型弹窗）或 Claude 自己在倒计时继续时不发，发通知说明；在终端里打字、会话自己继续了就取消。额度用完的错误条不再给“让 agent 修复”。先实测了两家怎么报告限额（PRD §6.6 / §6.7，`scripts/spikes/60-rate-limit-lab.mjs`，本地模拟 429，不花额度）：Claude 是 `rate_limit` 的 StopFailure，Codex 不发任何 hook、之后弹换模型菜单（往里打“继续”回车会换掉模型）；Claude 2.1.304 自己有 `autoContinueAtUsageLimit`。cc#13354（215 👍）、cc#35744（106 👍）、cx#21073（85 👍）、cx#28931（60 👍）。单元测试 `limit-resume.test.ts` / `normalize.test.ts` / `error-next-steps.test.ts`，e2e `limit-resume.spec.ts`。预约不跨 ⌘Q（只在窗口页面里，见已知问题）；Figma 待补（按钮和预约状态，现在照 `/compact` 的样式）；“每次限额自动预约”没做，有人提出再放进设置 · 自动化、默认关。随后其他点击发给 agent 的操作（错误条的“重试这一轮”“让 agent 修复”、审阅、评论和浏览器错误的“发给 …”、插入路径、冲突交给 agent、/compact 按钮）也在这些菜单开着时不打字，提示“终端里有选择框，请先在终端中处理”（`sendRefusal()`，单元测试 `send-protocol.test.ts` / `session-io.test.ts`，e2e 同上；合并面板的 `merge-sheet.spec.ts`）。拒绝的提示写在被点的地方：合并面板留在原处并在失败行说明，文件视图标题下一行，/compact 下的小浮层
- [ ] Option 当 Meta 的设置项（现在只映射了 ⌥← / ⌥→）。s#1359、c#2120
- [ ] 中文文案通读，统一术语。o#29320、o#8553（Orca 的机翻）
- [ ] 排查中文分支名在旧版 Apple Git 上被截断（Wavi 也用了 `%(refname:short)`，本机没复现）。o#19515
- 先访谈再定：多账号 / 按会话的启动配置（o#11557 17 👍、o#9496、o#9239、c#3317、s#8179；2026-10-20 搁置：换服务商大家用 CC Switch，它改的 `~/.claude/settings.json` Wavi 的会话本来就读；换订阅账号 /logout 再 /login；只剩“两个账号同时跑”，等有用户提出。设计稿留在 Figma 第 19 节，标了搁置）、~~多仓库任务（o#7568、s#2364，各 21 👍）~~（2026-10-24 改为要做，见“借鉴 T3 Code”）、非 GitHub 主机的 PR（o#4703、o#21181、o#15421）、繁体中文界面（o#10592）、国内网络下的安装和更新（三家 tracker 里几乎没人提）

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

合入链路（2026-10-27，PRD F16 / F13 v1.78，Figma 第 29 节；取代下面“PR 闭环”里的创建 PR 面板、PR 评论回到 Wavi、回到 GitHub 和 Wavi 自己等合并）
- [x] 调研和方案：用户最在意看 diff 和判断能不能合；8 家竞品里 6 家由应用执行 git / gh；方案文档和 Figma 29（2026-10-27）
- [x] 检查点 1：对比基线写在标题行，风险标记（规则，不花 token）和「这一轮跑过」放在出口上方（2026-10-27）
- [x] 检查点 2：「审阅全部改动」，审阅结果在变更顶部、diff 里只标级别，复审只看新增（2026-10-27）
- [x] 两个出口：合并到 main 并推送 / 创建 PR，主按钮记住仓库上次的选择；agent 写进 `.git/wavi/*.md`，扫一眼后 Wavi 执行（2026-10-27）
- [x] 检查点 3：推 main 后 base 上的 CI 回到原会话；自动修复改为 agent 只提交、Wavi 过刹车再推送（2026-10-27）
- [x] 砍掉：创建 PR 面板、行内 PR 评论和 PR 评论列表、发到 PR、标记已解决、Wavi 自己等检查通过再合并（2026-10-27）
- [x] Git · 变更 去掉分隔线、层级用色块（`bg/section`），自动修复停下时的回答放进底部、PR 行写「main 上也失败」、没跑检查不打勾（2026-10-27，PRD v1.79，Figma 29J / 29K2）
- [x] Git · 变更 按 Figma 29R 重排：展开的文件和 diff 内缩成块、文件行吸顶点一下收起、「全部收起」；审阅块操作进标题行、总评 1 行、发现两行和「其余 N 条」；出口区 28 行高（结论 → 事实 → 开关 → 决定底面）、PR #N 进结论行、方角开关（设置同步）；没有 P0 / P1 时默认勾最高一级（2026-10-28，PRD v1.86）
- [x] 已合并的 worktree 不再给「合并到 main…」，合并面板没东西可合时只写一行结果和「关闭」（不跑审阅、不列检查）；Worktree 详情的操作改成灰色底块、和标签列对齐（2026-10-27，PRD v1.83，Figma 第 30 节 `537:23660`）。测试：`src/main/git-merge.test.ts`（快进合并后 `merged: true`）、`src/renderer/panels/merge/model.test.ts`
- [ ] 作者在真实仓库各走一遍出口 A / B 和一次自动修复
- [ ] Figma 后再做：审阅自动时机收成一项「出口前自动审」、换对比基线

PR 闭环（2026-10-21 定，PRD F16 / F13 v1.63；排在第三批之前；外部来源：Conductor、Orca、Superset 在应用里看 PR 评论、发回 agent、合并 PR，Claude Code 桌面版的 Auto-fix 和 Merge when ready，Cursor Bugbot 自动修复限 3 次，o#9512 15 👍，GitHub community#189767）：
- [x] Figma：创建 PR 面板、变更视图的 PR 评论、合并面板的“合并到 GitHub PR”、PR 那一行的两个自动化开关（2026-10-21，Section 22 `364:13861`，待作者确认）：22A 创建 PR、22B / 22B2 变更视图（GitHub thread 落在 diff 行上、审阅行“发到 PR”、自动修复 / 通过后合并开关、PR 评论）、22C 合并到 GitHub PR、22D 检查还在跑、22E 自动化状态；新组件 PrThread、PrNote
- [x] F13 审阅结果按 worktree 存盘（每个留最近 10 次），复审不再报已忽略的发现（2026-10-21）：主进程 `review-results.json`（`ReviewResultsFile`），重启后同一份 diff 直接给存下的结果（`cached`），变更视图和合并面板打开时读回；删掉或取消勾选一条审阅评论算忽略（再勾上恢复），复审按“文件 + 标题”滤掉并写“另有 N 条你之前忽略过”。测试：`src/main/background-review.test.ts`（重启后不重审、忽略的不再落、再勾上回来）、`src/shared/background-review.test.ts`、`src/renderer/review/background.test.ts`
- [x] F13 另一家来审（Claude 写的由 Codex 审，反之亦然），设置 · 自动化 · 代码审阅（2026-10-21）：「谁来审」分段、Claude / Codex 两个审阅模型（旧的单个模型名是 OpenAI 的就挪到 Codex）；另一家没装时改用会话自己的并写明；状态行写“Codex 审阅找到 N 条”。测试：`background-review.test.ts`（假 codex 审 Claude 会话、`pickReviewer`）、`settings.test.ts`，e2e `settings.spec.ts`
- [x] L2 创建 PR 面板：标题、正文（PR 模板 / 提交说明）+ 证据块、草稿；“推送前审阅”打开时创建 PR 也先审。界面已接上（2026-10-21）：`src/renderer/pull-requests/CreatePrSheet.tsx`，正文用 PR 模板（`.github/pull_request_template.md` 等，不分大小写）或提交说明，证据块由 `evidenceBlock` / `withEvidence` 生成，从正文里删掉就不再加；面板说过会推送，第一次推送不再弹原生确认。e2e `pull-requests.spec.ts`（截图 `create-pr-sheet`）
- [x] L2 PR 评论回到 Wavi：一次 `gh api graphql` 取 checks、审批、合并状态和没解决的 thread；行内落成 F5 评论、PR 级评论列在 PR 行下；勾选“发给 agent”（不按回车）。主进程已接上（2026-10-21）：打开 / 草稿 PR 每次查询多一次 GraphQL（`PR_DETAILS_QUERY`），结果在 `PullRequestInfo.details`（thread、PR 评论和 review 正文、审批、`mergeStateStatus`、必需检查、仓库允许的合并方式、gh 用户），失败时沿用上次的；界面待做。界面已接上（2026-10-21）：thread 是变更列表里的一种定高行（`changes-model.ts` 的 `thread`），只放在“已提交”组、GitHub 还能定位的行上，默认勾选；其余和 PR 级评论在“PR 评论 · N”；文件有没提交的改动时标“可能已改”。“发给 … · N”一起发，发过的 thread 取消勾选。e2e 截图 `changes-pr`
- [x] L2 回到 GitHub：标记已解决（可附回复）、把 Wavi 审阅发到 PR（只发 COMMENT）。主进程已接上（2026-10-21）：`pr.resolveThreads`（只认 PR 上还没解决的 id，多条先确认）、`pr.postReview`（确认写明 @账号；行不在 PR 的改动里时改成一条总评论），GraphQL 变量走 stdin；界面待做。界面已接上（2026-10-21）：thread 行上“标记已解决”、审阅行上“发到 PR”（只发勾选的发现）
- [x] L2 合并 GitHub PR：合并面板“合并到”分段，预检（必需检查、本地和 PR 是否同一份、`--match-head-commit`）、仓库允许的方式、删除远程分支、检查通过后合并（GitHub auto-merge / Wavi 等待 / 合并队列）、合并后拉基线和归档。主进程已接上（2026-10-21）：`pr.merge` / `pr.cancelMerge`，本地有没推送的提交时先推送再等检查；合并后删远程分支（不碰本地）、拉取基线并在干净时快进。测试：`src/main/pull-requests.test.ts`（假 gh 认 `api graphql` 和 `pr merge`，真推送到本地 bare 仓库）、`src/shared/pull-requests.test.ts`。合并队列只按 gh 帮助实现，没在真实仓库上试过；界面（合并面板的“合并到”分段）待做。界面已接上（2026-10-21）：有打开的 PR 时合并面板默认“GitHub PR #N”，可切回“本地”（`PrMergeSheet.tsx`、`pr-model.ts`）；本地有没推送的提交或检查还在跑时按钮是“检查通过后合并”；合并后可归档。e2e 截图 `merge-pr`
- [x] L3 自动修复：按 PR 打开，必需检查失败或允许名单里的新评论 → agent 空闲时发出；每个 PR 最多 3 次、同一失败只发一次、agent 没推送就停，停下时提醒（2026-10-21）：`src/renderer/pull-requests/auto-fix.ts` + `auto-fix-model.ts`；发出的消息以“（Wavi 自动修复 第 N 次）”开头，用户自己发消息就清零；开关只存在窗口里，重启后按 设置 · 自动化 · PR 的默认值
- [x] L3 通过后合并：检查通过、没有没解决的允许名单评论、审阅没有 P0 / P1、不是草稿 → 合并（2026-10-21）：开关 = GitHub auto-merge（仓库没开时 Wavi 等），检查失败时也可以打开（等修好）；出现允许名单里的评论或审阅有 P0 / P1 时自动关掉。设置 · 自动化 · PR：证据块开关、两个开关对新 PR 的默认值、次数上限 1–5、机器人允许名单
- [x] 真实 GitHub 仓库上走一遍：创建 → 机器人评论 → 发给 agent → 修复推送 → 标记已解决 → auto-merge / 合并队列（同时补 M5 里“还没在真实仓库上走一遍”）（2026-10-21，公开测试仓库 meloer101/wavi-pr-loop-test 的 PR #1 / #2，结论见 PRD §6.11）：除合并队列外全部走通（免费账号的仓库开不了合并队列，没测）；评论用作者自己的账号代替机器人发；自动修复没在真实仓库上跑（要真的 agent）。走的时候修了三处：CI 日志里字面的 `^[[…m` 和 BOM、过时的 thread 在“PR 评论”里也能标记已解决、GitHub 自己合并后拉取基线。第三次（PR #3）用模拟的 agent（假 Claude 给出审阅结果；收到自动修复的消息后由测试脚本提交并推送）走了“创建 PR 时自动审阅 → 证据块进 PR 正文 → CI 失败自动修复（自己按回车）→ 通过后合并 → 基线跟上”，并修了三处：upstream 指向 origin/main 的分支会被直接推到 main（v0.4 起就有）、合并后变更视图底部仍显示“创建 PR / 合并到 main”、自动修复在 PR 列表和详情两次查询结果不一致时发出了没有日志的消息（现在重新查询，并等日志出来，最多 3 分钟）

第三批（先实测或先访谈）：
- [x] F21 派活与回报（2026-10-22，PRD F21 / §6.14 v1.66–v1.67，跨厂商 L4：任何一家 agent 都能派给任何一家，结果自动回到派活方；合并、推送、归档、批准权限仍只由人做）。外部来源：Orca orchestration（stablyai/orca#12988 空闲时往派活方终端里打提示，#21745 / #22651 因此替用户答了问题、混进草稿）、T3 Code `delegate_task`（pingdotgg/t3code#4499 做完叫醒父会话）、Nimbalyst meta-agent、Superset / cmux / Conductor / Vibe Kanban 只到派活方自己轮询；stablyai/orca#13079、#4376。实现前读了上面几家的源码（工具描述、子会话简报、合批和 ack、防环、深度限制）
  - [x] 实测（Claude 用 Haiku 两轮、Codex 用假模型）：Claude 收件箱的行格式、空闲时开新一轮、MCP server 拿得到收件箱和 `TR_*`；`codex queue` 送进 Wavi PTY 里的 Codex TUI（空闲、忙时都行），两个 Codex 的 hook 环境不串；Codex 的 MCP server 要 `env_vars` 才拿到 `TR_*`；`claude/codex -- "<文字>"` 起交互界面并提交首条消息。结论在 PRD §6.14
  - [x] 每次启动注入 stdio MCP server（`src/main/dispatch/`，Claude `--mcp-config`、Codex `-c mcp_servers.wavi.*`），经 hook socket 转给窗口（`broker.ts`，7 秒内答不了就让 server 轮询），守护进程不记这类请求；5 个工具、确认面板（`DispatchSheet`）、上限 4 个、判重、子会话没有工具；设置 · 自动化 · 派活两项开关；agent 启动参数全部改由 main 拼（`hostLaunch`），首条消息和模型放在命令行上
  - [x] 回报：一轮结束 / 出错 / 退出 → 报告（分支、diff 统计、检查、冲突、最后一条消息摘录），3 秒合批、每个子会话只留最新一份、`read_result` 读过的不再送、每小时最多 20 次；Claude 走收件箱、Codex 走 `codex queue`，送不进去时留在派活会话下方的「送进去」条（`HeldReportsStrip`）
  - [x] 界面：侧栏子会话紧跟派活会话、缩进一级；会话头“由「…」派出”；总览“派出的会话”一节和「比较」；workspace.json 存 `dispatchedBy` / `dispatchTask`
  - [x] 测试：e2e `dispatch.spec.ts`（6 个，真实链路，两种主题截图在 `test-results/dispatch/`）；`src/shared/dispatch.test.ts`、`src/main/dispatch/*.test.ts`、侧栏和存盘的单元测试
  - [x] 真实 Claude / Codex 互相派一次活（2026-10-22，作者同意后跑，PRD §6.14）：Claude（Haiku）派给 Codex、Codex 派给 Claude 都走通，Claude 派完会按工具说明结束这一轮，报告到了会读、会自己调 `read_result`。作者的 Codex 服务商当天对 `gpt-6-sol` 返回 503，所以 Codex 用的是真 CLI + 本地假模型；真 Codex 模型自己会不会照说明派活还没看到。顺带修了两处：Codex 默认对每次 MCP 工具调用都先问用户（现在注入 `default_tools_approval_mode="approve"`），以及一轮结束却没有回复时报告写明“可能出错了”
  - [x] Figma 补 F21 的画面（2026-10-29，Figma 第 40 节；总览一节和待送报告条照旧，没有另画）
  - [x] 确认挂在派活会话下（2026-10-29，PRD v1.99，Figma 40B–40F）：派活会话变“等你处理”、写 `想开 N 个会话`；终端下方的确认条代替全窗面板；侧栏状态图形列画细线连到每个子会话
  - [x] Esc 打断等待中的 `start_sessions` 时收掉确认条（2026-10-29，PRD F21 v1.99 / §6.14 实测：Claude 发 MCP `notifications/cancelled`，Wavi 的 server 转成 `WaviCancel`）；agent 退出时自动当作拒绝。Codex 按 Esc 时发什么没实测。修（2026-10-29）：开着「自动开始」时，Wavi 还在准备这批会话就按 Esc，会话照样开出来；取消过的 callId 也一直留在内存里（`handler.test.ts`）
- [ ] F21 重做（PRD v1.103，2026-10-30 定）：`wavi` 命令代替按厂商注入的 MCP server，任何能跑 shell 的 agent 都能派活；19 家都能派和被派，回报分三档（原生通道 / 复用 §6.9 发消息链路加两道检查 / 「送进去」条）；最多两层、只确认第一层；子会话 `wavi report` 主动报 + Wavi 兜底；`--base snapshot` 给审阅用；报告送进去时子会话一轮结束不提醒用户；侧栏写 agent 和模型
  - [x] 实测 5 项（2026-10-30，PRD v1.104 / §6.14）：Claude 能跑 `wavi`；Codex 能跑但默认沙箱拦 unix socket → `wavi` 改用文件通信，Codex 配置一项不动；Pi 扩展 `sendUserMessage` 送进 TUI、草稿保留；Claude / Codex / Pi / Grok 能按次追加系统提示；快照带未提交和未跟踪文件；PATH 改写进 `-c` 脚本
  - [ ] 实测 OpenCode `prompt_async`（本机没装 OpenCode，未测）
  - [ ] Figma 第 41 节：侧栏子会话的 agent 和模型、第二层缩进和连线，作者看过再实现
  - [ ] 实现：`wavi` 入口和命令、能力表扩到 19 家、三档送达和两道检查、两层与上限、快照 worktree、不提醒用户；删掉 `mcp-server.ts` / `mcp-config.ts`
  - [ ] 测试：e2e `dispatch.spec.ts` 重写（PRD F21 验收），单元测试
- [ ] agent teams 的队友和子 agent 只显示、不接管（PRD F21 v1.66 改）：在派活会话下列出 Claude 自己开的队友 / 子 agent 的名字和状态（来自 hook 的 `agent_id`、`TeammateIdle`），不变成 Wavi 会话。~~学 cmux 用 tmux 假命令接管成侧栏会话~~：agent teams 仍是实验功能，Claude 发出的 tmux 命令没有文档，只有 Claude，队友没有自己的 worktree，跨厂商派活由 F21 做。cc#24122（96 👍）、cc#24189（74）、cc#26572
- [ ] 手机提醒：不做 App，“等你处理”推到 Bark / ntfy / 飞书 / 企业微信机器人，设置里打开、默认关闭。cc#29438（69 👍）、cc#28765（44）、Superset Mobile（Product Hunt 当日第一）
- [ ] 读 `claude agents --json`，把 Claude 自己在后台开的会话（会自己建 worktree、开 draft PR）也显示到总览

暂不做（追竞品清单，PRD §1.2 不追；单条需求票数也低）：Linear / Jira 接入、SSH / 云 VM / 手机 App、自动合并。多仓库工作区 2026-10-24 改为要做，见下面“借鉴 T3 Code”。

## 进行中：借鉴 T3 Code（2026-10-24 定）

来源：2026-10-24 读了 T3 Code（pingdotgg/t3code @ d53873b6）的源码、issue 和 discussion，结论见 PRD v1.68。按下面的顺序做；每一条都写了它做到哪一步、Wavi 怎么做。

1. 一键提交 / 推送 / PR（PRD F16 v1.68）。T3 是一个按钮按 git 状态换文字，一路跑完提交、推送、建 PR，提交说明和 PR 正文由小模型写、不提示花额度；stacked PR 只读 GitHub 原生的 stack。
   - [x] 一期（2026-10-24，PRD F16 v1.68）：Git · 变更的按钮文字跟着状态走（有未提交改动 →「提交、推送并创建 PR」，已有 PR 时为「提交并推送」；没有未提交改动、有没推送的提交 →「推送并创建 PR」/「推送」；没有可做的 →「打开 PR #N」）。面板多一段「提交」：勾选文件、编辑提交说明，提交前看得到会写进去什么；然后按顺序提交 → 推送 → 创建 PR，每一步写明进度，git hook 失败时显示它的输出；远程分支有本地没有的提交时写明原因、不推送。主进程 `commitWorktree` / `pushBranch`（`src/main/pull-requests.ts`），按钮逻辑 `ship-model.ts`；测试：`src/main/pull-requests.test.ts`（真实 git 仓库：只提交勾选的、hook 失败带输出、冲突 / 基线 / 分离 HEAD 拒绝、被拒的推送）、`ship-model.test.ts`、e2e `pull-requests.spec.ts`「提交并推送」，两种主题截图 `test-results/pull-requests/ship-sheet-*.png`
     - [ ] Figma 补面板的「提交」一段和按钮的几种文字（现在沿用 22A 的组件）
   - [x] 二期 AI 写（2026-10-24，PRD F16 v1.68）：面板里「AI 写」/「AI 写标题和正文」另起一次本机 Claude / Codex（默认 Haiku），写好填进框里；悬停写明模型和额度，谁来写、模型和“打开面板时自动写”（默认关）在设置 · 自动化 · PR。`src/shared/ship-writer.ts`、`src/main/pr-writer.ts`；测试 `ship-writer.test.ts`、`pr-writer.test.ts`（假 claude / codex，只在测试目录里找 CLI）、e2e「提交并推送」里点一次 AI 写
   - [ ] 三期：stacked PR。会话基于另一个会话的分支开出来时，PR 的 base 就是那个分支；图谱画出 stack；合并 stack 用 GitHub 的接口；级联 rebase 先用 merge-tree 预检
   - [ ] 非 GitHub 主机（仍在上面的“先访谈再定”）
2. [ ] 引用会话（T3 的 `@thread`）：⌘K「引用会话…」或把侧栏的会话拖进终端，往输入行插一段引用、不按回车；wavi MCP 加 `read_session`，只能读被引用过的会话；没装 MCP 的 agent 改为贴一段摘要（最后一条消息、diffstat、检查结果，限长）
3. [ ] fork 会话：从最新处 fork 成新会话（`claude --resume <id> --fork-session` / Codex 的 fork），对话历史完整带过去；开新 worktree（未提交改动用 `git stash create` 带过去；作者 2026-10-24 定）。fork 出来的是一个普通会话：出现在侧栏原会话下面，不分屏、不自动切过去，用户点开后和其他会话一样占满终端区域（作者 2026-10-24 定）。T3 fork 出来的线程和原线程共用一个 worktree
4. 小补丁
   - [ ] 收件箱：snooze（隐藏到需要你时，要批准、要回答、出错时提前冒出来）；PR 已合并时提示可以归档。不做 3 天自动收起
   - [ ] 额度用完：设置 · 自动化加「额度恢复后自动继续」，默认关；snooze 到重置时间。以后：换一个账号继续（T3 也还没做）
5. [ ] 定时任务：按间隔或固定时间；每次开一个新会话（新 worktree，首条消息放在命令行上），或在已有会话空闲时发一条；调度放在 PTY 守护进程，⌘Q 后照样跑；列表写明会发什么、发给谁；不做 webhook
6. [ ] 多仓库项目（必须做，单独设计）：先读社区 fork LoganRupe/t3code 的 `multi-repo-workspaces` 分支和 t3code#7041（▲85）、#15752，再出方案。方向：一个项目包含多个仓库；会话的工作目录是一个工作区文件夹，每个选中的仓库各开一个 worktree，按原来的相对位置摆放；变更、合并、PR 和冲突雷达按仓库分组
7. [ ] 原生适配更多 agent（作者 2026-10-24 定，取代原来的“在一个窗口里让 agent 来回切换”：同一个窗口里开 Claude / Codex、切换、分屏都已经有了，中途换 agent 不做）：现在新建会话只能选 Claude 和 Codex，要加上 OpenCode、Grok、Pi、Gemini、Qwen 等，能加的尽量都加；只接原生 agent 用它自己的模型（作者 2026-10-24 定：DeepSeek、Kimi、GLM 这类“Claude Code 换接入地址”不做，用户自己用 CC Switch 切）。底线：和 Claude / Codex 一样，在新建会话面板里选了就能直接启动。做到多深（作者 2026-10-24 定，依据是读完 Orca、cmux、Superset、T3 Code、Vibe Kanban 的实现和各家 CLI 的接入口）：
   - [x] agent 抽成一张能力表（2026-10-24，`src/shared/agents.ts`，19 家：命令、安装命令、首条消息、续上对话、模型、状态来源；`AgentKind` = 这些 + 终端）。只认 Claude / Codex 的功能（派活、额度、后台审阅、一题多解、发送协议的占位符）改成显式判断，其他 CLI 用通用发送参数
   - [x] 终端状态协议 OSC 7501（2026-10-24，PRD §6.15）：`src/shared/program-status.ts` 解析 rev 0.4 的根记录，状态桥在输出流上立即回答 `OSC 7501 ; ?`（早于 DA1），报告进状态机；OpenCode 2、Grok、Crush、Goose、Pi ≥1.1 不注入就准确。真 Grok 1.0.67 实测：问答后报出 blocked / permission。不发的 CLI 看标题转圈（估计）
   - [x] ① 底线（2026-10-24）：新建会话的智能体菜单里选（Figma 24A，按项目记住），在 worktree 里直接启动，能续上之前的对话（有 hooks 的按 id，其余“续上这个目录里最近的”），能带首条消息的带上；设置 · 智能体（25B）列已安装（版本、状态准确 / 估计）和没装的安装命令
   - [x] ② 准确状态（2026-10-24，PRD §6.15）：Gemini（system-defaults 文件 + `--skip-trust`）、Qwen（system-defaults 文件）、Pi（`-e` 扩展 `resources/hooks/wavi-pi.js`，真 Pi 0.84.1 实测能加载、报 SessionStart / SessionEnd）每次启动注入 hooks；OpenCode 2 的插件跑在共享后台服务里注入不到，改走 OSC 7501（同样准确，但没有“当前在做什么”的工具细节）。测试：`cli-normalize.test.ts`、`cli-adapters.test.ts`、`program-status.test.ts`、`agent-launch.test.ts`、`agents.test.ts`，e2e `more-agents.spec.ts`（假 opencode 问 OSC 7501、报 working / blocked，两种主题截图 `test-results/more-agents/`）
     - [ ] Gemini、Qwen、OpenCode 和其余各家在真 CLI 上走一遍（本机没装；花额度的步骤列进“待作者手动确认”）
     - [ ] 权限栏（在 Wavi 里批准）：Gemini 的 hooks 不能批准；Qwen 要在对话框画出来之前答；OpenCode 插件可以 `permission.reply` 但注入不到。暂时都在 TUI 里答
     - [ ] Copilot CLI、Cline、CodeBuddy 的 hooks 以后看；Copilot / Cursor / Antigravity 的目录信任每个新 worktree 问一次（没有不写全局配置的办法）
   - [ ] Kitty 键盘协议：Copilot、OpenCode、Grok、Droid、Pi 用它区分 Shift+Enter 和 Enter，Wavi 现在关着（PRD §6.3），先实测这几家能不能换行
   - 不做：Grok 的准确状态（只能在 worktree 里放项目级 hooks 再加 `--trust`，会写 Grok 自己的信任列表，算写用户全局配置），Grok 只做 ①；③ 全功能（MCP 派活、额度、审阅）等有人要再做；iFlow（已停服）、社区版 grok-cli、Trae（是 IDE）
   - [x] Figma 先画新建会话面板的 agent 选择（现在是 Claude Code / Codex / 多个三段，放不下十几家）和设置里的 agent 列表，作者审过再写界面。2026-10-24 画了第 24 节 `412:16282`（24A 智能体菜单 · 24E 浅色；24B 多个待重画，24C 被 25B 取代，24D 接入地址作废）和设置的智能体页（25B），待作者确认

8. [x] 设置去掉分隔线（作者 2026-10-24 定，2026-10-24 完成）：行与行之间、导航和内容之间、输入框和按钮的描边、外观页预览框都不画线，分组靠留白和分组标题。Figma 第 25 节 `416:17440`（25A 外观 · 25B 智能体 · 25C Worktree · 25D 自动化 · 25E 关于 · 25F 浅色，作者已确认）。行高 40、分组间距 40，输入框 / 按钮 / 开关 / 预览框 / 字体菜单的分组线都去掉；只留主题色板选中时的一圈和弹窗外沿
9. [x] 同任务多解（原一题多解）改从对话里发起（作者 2026-10-24 定方向、2026-10-25 定细节，2026-10-25 完成，PRD v1.69）：会话头「…」/ ⌘K / 「会话」菜单、终端右键（新加：复制 · 同任务多解… · 全选）、出计划时终端下方那条，都叫「同任务多解…」，⇧⌘N；弹框任务取选中的文字、计划或说过的话；原会话不算一份，几份都开新 worktree、基于原会话的分支，所有已安装的智能体都能选，侧栏缩进在原会话下；都停下后合成一条汇报送给原会话（Claude 收件箱 / `codex queue`，别家点「送进去」）；去掉新建会话面板的「多个智能体一起做」。Figma 第 26 节 `425:19405`（26A–26J）。还没做：汇报只在 Claude / Codex 会话上自动送达；说过的话不跨重启；真 CLI 上没跑过（e2e 用假 Claude / Codex）

不做：中途换 provider（作者 2026-10-24 定）；消息排队（原生 TUI 本来就能排队，最多补“⌘Q 后排着的消息由 Wavi 补发”）；聊天界面。

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
- [x] B21 主目录作为会话文件夹时反复弹“Wavi 想访问桌面”（2026-10-26，PRD v1.72，v0.8.1）：文件视图对根目录的递归监视、非 git 文件夹的遍历和终端路径的解析，在根目录是主目录（或包含桌面、文稿、下载）时跳过这三个文件夹，只监视主目录自己的条目。`src/main/protected-folders.ts`，测试 `protected-folders.test.ts`、`worktree-files.test.ts`。没处理：主目录本身是 git 仓库时 git 仍会读这三个文件夹；那台电脑上的实际触发条件没有复现过，是按代码推断的
- [x] B22 项目主目录检出功能分支时「合并到 main…」「创建 PR」是灰的（2026-10-27，PRD v1.77）：只在主目录检出基线分支本身、没有基线或分离 HEAD 时禁用（`onOwnBase`），Worktree 详情里主目录也有「合并到…」
- [x] B23 输入法拼音写到终端右边缘时卡片被推向左边、上屏后回不来（2026-10-28，PRD v1.88）：预编辑文字和 xterm 的输入框不超出终端屏幕（`placePreedit`，`src/renderer/terminal/ime.ts`），e2e `cjk-input.spec.ts` 复现并覆盖
- [x] B24 接了鼠标的 Mac（系统设置「显示滚动条：始终」）上每个终端右边多一条滚动条颜色的竖带（2026-10-30）：xterm 6 自己画滚动条，但它的 `.xterm-viewport` 仍是 `overflow-y: scroll` 且铺满整个终端，原生轨道（10px）贴在终端右边缘。全局去掉这个原生滚动条（`src/renderer/styles/base.css`），设置预览里同样的规则合并进来。用 `::-webkit-scrollbar` 强制常驻滚动条实测：修复前 viewport 占 10px、右边缘是轨道色，修复后 0px、和终端底色一致，滚轮翻 scrollback 不受影响
- [x] B25 squash 合并到 main 之后底部仍出「合并到 main 并推送」，再点会让 agent 重写提交说明、往 main 写空提交（2026-10-30，PRD v1.101）：按提交数分支仍领先；改为按内容判断（合进基线后的树等于基线的树），出口预检和合并预检都用它
- [x] B26 Git · 图谱一个提交上有多个 ref 胶囊、右侧栏变窄时，每个胶囊都缩成只剩边框和半个图标，提交说明也被挤没（2026-10-30）：胶囊各自 `flex-shrink`、提交说明 `flex-basis: 0`。胶囊合进最多占半行的 `.pills`，放不下的换到被裁掉的第二行、整个隐藏；`Pills`（`GraphView.tsx`）在宽度变化时把组宽收到第一行最后一个胶囊（向上取整，否则小数宽度会把它也挤下去）
- [ ] B27 「合并到 main 并推送」写死 squash，squash 后分支不是基线的祖先、提交图和「领先 N」把它当成没合并（2026-10-30，PRD v1.105）：方式跟随仓库（GitHub 设置或第一次选后记住），squash 后分支移到 squash 提交上。主进程和共享层已完成；渲染层等 Figma 第 43 节定稿
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
  - [x] F14 端口检测（2026-10-19）：有会话时主进程仍用 `src/main/browser/ports.ts` 的 `ps` + `lsof`，大约每 3 秒扫每个 PTY 进程树（不再只在浏览器页签打开时扫）；窗口订阅每个会话的最近一次结果，所以侧栏会话行和总览在重载后也能显示 `:5173`，不必先打开浏览器页签；点击在右侧栏浏览器打开，⌥ 点击用系统浏览器打开，右键结束进程。主进程只结束该会话最近一次扫描里的 pid（`sessionListener`），没有通用的杀进程 IPC。同一会话超过 2 个端口时其余收成 `+N`；e2e 在 `browser-panel.spec.ts`（关着浏览器页签时侧栏和总览出现标签、⌥ 点击、右键确认后结束）。agent CLI 自己的监听（Claude Code 的本地 socket）不列（2026-10-28，PRD v1.85，`isAgentCli` 单测）
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
- ~~GitHub PR 合并、应用内看 PR 评论（o#9512）~~ 移到“进行中：多 agent”的“PR 闭环”（2026-10-21，PRD v1.63）
- [x] 文件预览：长行自动换行、Markdown 渲染（2026-10-21，PRD F17 v1.59）：react-markdown + remark-gfm，HTML 经 rehype-raw + rehype-sanitize（GitHub 白名单）；链接打开内置浏览器 / 文件预览 / 标题锚点，标题行切换源码。顺带修了切换文件时短暂显示上一个文件内容的问题。纯逻辑 `markdown-model.ts`（链接解析、不越出 worktree、标题锚点），e2e `right-panel.spec.ts`（截图 `13f-markdown`、`13f-wrap`，两种主题）。Figma 13F 待补渲染态；`npm run dev` 下 worktree 图片因页面不是 file:// 加载不出、显示替代文字，安装版正常（未在真机看过）
- [x] 终端底色可改 + 导入 Ghostty / iTerm 主题（2026-10-25，PRD F7 v1.71，Figma 07b）：设置 · 外观 · 窗口的「终端底色」（跟随主题 / 自定义）和「底色值」，主题色块下的「导入主题…」；底色 + 前景 / 光标 / 选区 / 16 色原样用于终端，没有导入时前景和 16 色按底色明暗选深色或浅色一套（`shared/terminal-tokens.ts`，测试对照 tokens.css）；解析在 `shared/theme-import.ts`，读文件在 `main/theme-file.ts`；读不了的文件用原生对话框说明（这个对话框没在 Figma 里画）。测试：`color` / `theme-import` / `settings-terminal` / `terminal-tokens` / `theme-file` / `custom-theme` / `map-custom`，e2e `settings.spec.ts` 和 `appearance.spec.ts` 各一条。以后：导入后在主题色块里加一个色块、Alacritty / Kitty / WezTerm 格式
- [x] 玻璃外壳 + 侧栏 / 右侧栏开合动效（2026-10-26，PRD v1.73 §5，Figma 第 28 节 A–F）：外壳只有深色 / 浅色两套（原生毛玻璃 + `--glass-shell`），导入主题只改终端卡片；会话头、侧栏、右侧栏标题行在玻璃上，终端、右侧栏内容、总览、欢迎页是卡片（圆角 10、间距 6）；分屏的细线换成 6 宽的玻璃缝（`SPLIT_GAP` = 6）；去掉「侧栏毛玻璃」设置。开合：`app-shell/drawer-motion.ts`（宽度弹簧 460 ms、内容滑入 + 模糊，动画中终端不重排、结束时重排一次），侧栏抽成 `SidebarDrawer.tsx`（副窗口共用）。右侧栏放不下时先变窄到 400 再浮起（`panelWidthFor`，作者拖宽右侧栏后它盖住了终端）。右侧栏打开时会话工具在它上方、窗口最右（Figma 28G / 28H，PRD v1.74：`SessionHeader` 的 `part` = full / title / tools，两种窄宽规则分开），菜单和会话头弹出层换成玻璃外壳的浮层（实色 `--float-bg` + 细边 + 高光，不用 `backdrop-filter`：在透明窗口里它会把周围一块玻璃压暗，作者发现的），弹出层画进 body。测试：`drawer-motion.test.ts`、`split-layout.test.ts`、`layout.test.ts`，e2e `appearance` / `right-panel` / `split` / `no-dead-ends` 更新了几何断言（`right-panel.spec.ts` 跑了 13 次有 2 次各挂在不同用例上，改动前 4 次全过，还没查清是不是动效的时序）；用 Playwright 逐帧量过宽度（右侧栏 0 → 508 回弹 → 486，侧栏 → 276 → 264，终端卡片每帧跟随）。没在真实桌面上看过毛玻璃的实际观感（e2e 截图里玻璃后面没有壁纸）
- [x] 启动画面 + 欢迎页入场（2026-10-29，PRD v1.98 F18 / §5，Figma 39G–39J；作者看过样稿后选 B1「聚」和 L4）：`src/renderer/public/boot.js`（不进打包，主题镜像、卡片位置镜像 `tr.boot.layout`、`window.__waviBoot.claim` 交接）+ `boot-worker.js`（OffscreenCanvas 上画约 330 个细点，主线程不参与）；欢迎页入场 `app-shell/mark-entrance.ts`（Web Animations 关键帧，纯函数）、`boot.ts`、`mark-segments.ts`，`EmptyMain` 的标志改成四段 SVG；玻璃改为显示前挂上（`main/appearance.ts`）。测试：`mark-entrance.test.ts`，e2e `smoke.spec.ts` 加交接用例。测量（Playwright，新档案，新旧交替 8 / 8 / 12 次）：首次可交互中位数 307 / 305 / 254 → 299 / 331 / 271 ms（噪声约 ±40），首帧 328–384 → 140–176 ms；录屏逐帧：改动前约 67 ms 黑框 + 33 ms 空玻璃，改动后第一帧就有玻璃和卡片。先试过用 DOM 画细点，首次可交互晚 15–75 ms，所以改成 Worker
- [ ] 孤儿 worktree 自动回收
- [x] 总览批量操作（多选后停止、关闭、发送同一条消息）（2026-10-21，随多 agent 第二批的“一题多解 + 广播”提前做完，PRD F9 v1.60）
- [ ] PRD §4 “P2 储备”中的各项

### D · 发布质量（穿插在各批次里）
- [ ] 官网 `site/`：2026-10-21 按 Figma W11（PRD v1.61）改版，并改为 Astro 项目——开机引导、WebGL 老电视问号、全屏产品窗口首屏（会话轮换、git 栏新提交、滚动时显像管关机）、总览三步 + 通知和 Dock、一题多解三格比较（可合并、看 diff）、8 条分支的图谱播放头、叠印 + 六栏、线网轨道海报、ASCII 粒子页尾，以及光标拖尾、信号故障转场、输入 wavi 的彩蛋。2026-10-21 加了英文版（默认 `/`，中文在 `/zh/`，PRD v1.62），去掉了自定义光标和拖尾；加了整屏吸附（宽于 900 时），并按 1280 / 1024 / 900 / 768 / 375 五种宽度、中英两版过了一遍版式。还没做：继续按作者意见删减动效、og:image、文档页（Starlight）
- [x] D1 性能基线：10 / 20 个会话的内存、输入延迟、冷启动，8 小时长跑（2026-10-20，PRD §6.12）。外部背景：三家竞品都有内存 / CPU 随时间涨的 issue——o#10928（正常使用中越用越重）、o#19768（主进程每秒漏 26 MB 直到被系统杀掉）、s#3049（渲染进程 60 分钟涨到 3.2 GB 后 GC 卡死）、c#5209（2 GB 涨到 12 GB），Electron 和 xterm.js 被点名；在多 agent 这个定位上，稳定跑 10–20 个会话是前提
  - [x] 8 个会话的第一份数据（2026-10-20，假 agent，M4 Retina，修复图集之后的构建）：每个会话约 4900 行中文回滚、空闲时 Wavi 加守护进程约 1080 MB，输入延迟 p50 / p95 为 13 / 20 ms；7 个会话在后台各输出 40 行/秒时，内存峰值 1123 MB，渲染进程 CPU 6–10%；在正在输出的会话里打字为 29 / 40 ms
  - [x] F20 4 格同时在屏（2026-10-20，`split-latency.spec.ts`，TR_STRESS=1，假 agent 每格 40 行/秒，M4 Retina，WebGL，三次）：只有键盘所在那格安静时 p50 / p95 为 11 / 18–50 ms；其他三格输出时 10–13 / 19–49 ms；四格都在输出时 12–13 / 55–83 ms。p50 达到 PRD F20 的 < 16 ms，p95 有长尾（四个 WebGL 终端同帧重绘），待查
  - [x] 10 / 20 个会话和冷启动（2026-10-20，M4 16 GB，`TR_SCALE=1 npx playwright test e2e/scale.spec.ts`）：假 agent `e2e/scale-agent.mjs` 跑真实的按次 hooks、statusLine 和 transcript，像 agent 一样画标题、工具调用、彩色中文和权限框；项目是带 worktree 的 git 仓库。冷启动（启动到侧栏出现全部会话）0.45–0.72 s，目标 ≤ 2 s。内存（各进程工作集 + 守护进程；括号里是活动监视器口径的 phys_footprint）：10 个会话空闲 668（460）MB、9 个各输出 20 行/秒 570（502）MB、全部输出 617（610）MB；20 个会话 703（409）、609（535）、669（763）MB，目标 < 1.5 GB。输入延迟（按键到显示回显的那一帧）p50 / p95：10 个会话 10 / 18（空闲）、12 / 20（9 个输出）、11 / 19 ms（全部输出）；20 个会话 11 / 18、11 / 20、11 / 20 ms。p50 达到 < 16 ms；p95 多出的 2–4 ms 是“下一帧才显示”，一个会话空闲时也是 18 ms，不随会话数变。19 个会话输出时渲染进程 CPU 1.5%、主进程 0.4%、守护进程 2.8%
  - [x] 修掉的规模问题：隐藏的终端每帧整屏重画（PRD §6.3，`paused-selection.ts`）。修之前 20 个会话里 19 个输出时 p95 65–1632 ms、最长卡 1.8 s，渲染进程 CPU 6.6–11%（8 个会话那份数据里的 6–10% 也是它）；修之后见上
  - [x] 突发输出（2026-10-29，`TR_SCALE=1 npx playwright test e2e/scale.spec.ts -g burst`，M4 10 核）：20 个会话，K 个隐藏会话各一次写出 32 MB 彩色中文（假 agent 的 `b`，PTY 收多快写多快），键盘在一个安静的可见会话。**三次正式运行的 1 分钟 load 都在 5.2–8.1（> 4，同机有其他会话在构建 / 测试），数字不可靠，要在空闲机器上重跑**；各段耗时的分布在 load 5–67 的 7 次运行里一致。输入延迟 p50 / p95 / max：安静 11–12 / 16–18 / 16–19 ms；K = 3 时 13–22 / 18–94 / 20–104 ms（突发只持续 3.3–3.8 s）；K = 10 时 279–308 / 422–443 / 446–502 ms，突发 12.2–12.4 s 写完。渲染进程没有 ≥ 50 ms 的长任务，main 事件循环最长迟到 2 ms。按核计 CPU（`ps`）：守护进程 83–96%、渲染进程 47–58%、main 44–50%；总吞吐 25.7–28.5 MB/s，不随 K 变
  - 延迟拆段（测试侧计时：按键 → agent 收到 → main 的 `webContents.send` → 渲染进程收到 IPC → 屏幕出现）：K = 10 时 agent → main 的 p50 255–298 ms，main → 渲染进程 0–2 ms，渲染进程解析加出帧 7–8 ms。等待发生在守护进程这一段：它单线程处理所有会话、已饱和，可见会话的回显排在隐藏会话未确认的数据后面；每个会话最多 1 MB 未确认（`flow-control.ts`），10 × 1 MB ÷ 26 MB/s ≈ 385 ms，和 p95 422–443 ms 吻合。守护进程 JS 时间（CPU profile，K = 10）：headless 镜像解析 51%、PTY 读数的 UTF-8 解码 15%、socket 写 14%、JSON 成帧 11%；渲染进程忙的时间 86% 是 xterm 解析（隐藏终端），但它有约 60% 空闲
  - 结论和建议顺序：①按可见性区分背压（隐藏会话用小得多的水位线，或守护进程先发可见会话的数据）——直接对应测到的排队；②减少守护进程每字节的工作（镜像解析占一半；二进制帧能省掉 JSON 和解码那约 25%），提高吞吐，排队等比例缩短；main 不是瓶颈，“离开 main”本身收益小；③隐藏终端的解析只占 CPU（约半个核），这组数据里不造成延迟；④缩短回滚没有证据和突发延迟有关。另：Electron 的 `percentCPUUsage` 是按 10 个核平均的（同一段时间 4.4 对 `ps` 的 44），上面 10 / 20 个会话里的“渲染进程 CPU 1.5%”约等于单核的 15%
  - [ ] 8 小时长跑（`TR_SCALE_SOAK_MIN=480 … -g soak`，20 个会话按真人节奏循环：20–120 s 一轮、30–300 s 空闲，偶尔权限框和并行子 agent，每 20 s 切换会话、每 10 分钟开一次总览）：三次都在合盖时被结束（55 分钟、3.96 小时、21 分钟）：机器用电池，合盖就睡眠（`caffeinate -s` 只在接电源时有效），系统日志里每次都是睡眠事件之后 50–400 ms，测试启动的应用或守护进程收到 SIGTERM / 退出，没有崩溃报告。复测：20 个会话工作时 SIGTERM 守护进程，应用 0.1 s 内拉起新的、继续运行（但那些会话结束了）。要跑满 8 小时得接电源、开着盖子。最长的 3.96 小时：热身约 1 小时（回滚填满）之后，渲染进程 JS 堆平均 65 MB（+1 MB/h）、主进程 11 MB，不涨；各进程工作集之和平均 1.18 GB，不涨（−98 MB/h，部分被压缩）；守护进程约 160 MB；footprint 在 1.2–1.5 GB 之间来回（拟合 +29 MB/h，噪声大），最高 1.51 GB，大头记在 GPU 进程上。平均 CPU：渲染 0.7%、GPU 0.3%、主进程 0.2%、守护进程 1.3%。没看到泄漏；完整 8 小时还没跑成。长跑现在按进程类型拆 footprint（一次 10 个会话的试跑里 0.71 GB 中 GPU 进程占 0.44 GB），被中断时也写出汇总
  - [x] hook 大载荷不再堵终端输出（2026-10-29）：守护进程转给 app 的 hook 和终端字节走同一条 JSON-lines socket，一个几 MB 的 PostToolUse（Read 的文件、Bash 的输出、Write 的内容）会让所有终端的输出排在它后面。`src/shared/hook-payload.ts` 的 `trimHookPayload` 只动 `tool_input` / `tool_response`：长字符串留开头和结尾（输入开头 20 000 字、响应结尾 16 000 字即 Bash 检查读的尾部、Codex 的 `Exit code:` 在开头），响应里的列表留 100 项，todo 工具原样，Codex apply_patch 只留 `*** … File:` 行；守护进程转发和写 journal 前裁一次，`normalizeHook` 入口再裁一次（幂等，覆盖 app 自己的 hook socket）。同一次工具调用的 PreToolUse / PermissionRequest / PostToolUse 裁成同一个 input，权限框和 tool-end 仍按 `toolCallKey` 配对。`LineReader` 原来每来一块都从缓冲区开头重新找换行：64 字一块时 1 / 2 / 4 MB 的帧要 1.8 / 6.6 / 27.5 s；改成未完的帧按块存、只在新块里找换行，8 MB 测试在 2 s 内。
  - [x] 终端快照不再卡主线程（2026-10-29）：main 存快照改用 `fs/promises`（先写临时文件再改名，同一会话的写入排队，排队中的旧快照被新的取代），读快照改成异步 `load`（去掉 `loadSync` 的同步 IPC，渲染进程和 main 都不再等最大 2 MB 的读盘）；退出时等在途写入，最多 2 s。渲染进程和守护进程的“安静 3 s / 30 s 再存”不再每个输出块重设计时器，只记最后输出的时间，到点没安静够就补等剩余时间（`src/shared/quiet-timer.ts`）
  - [x] 侧栏选区色块不再每次渲染都量行（2026-10-29，`SelectionDrop.tsx`）：以前侧栏每次 commit（任何会话的状态 / 当前动作变化）都查询并读取在显示的行的位置，强制同步布局一次；现在只在显示的会话变化时量，其余由项目分组和行上的 ResizeObserver 跟随（布局之后触发，不强制布局），没变的帧不写样式。4 格分屏、600 次会话 patch（假数据，每 16 ms 两次）的 Chrome trace：强制布局 300 → 0 次（150 → 0 ms），渲染进程布局合计 221 → 140 ms；折叠项目、改窗口宽度后色块仍贴着行。动画帧仍写 width / height：换成 scale 会把 1px 边光、阴影和圆角一起拉伸，12 px 的水珠会失去边光
  - [x] 小项（2026-10-29）：启动时用 Electron 的 `process.getSystemVersion()` 判断 macOS 26，不再同步跑 `sw_vers`；Liquid Glass 原生模块没加载上时退回 vibrancy；workspace 和 session-meta store 没有变化时返回原 state，不再通知全部订阅者
  - [x] 按可见性区分背压（2026-10-29，上面突发输出的建议①）：不在格子里显示的会话在途输出上限从 1 MB / 250 KB 降到 128 KB / 64 KB（`flow-control.ts`；下限不小于渲染进程 32 KiB 的 ack 批量），渲染进程把每个终端是否显示经 `pty.setVisible` 告诉 PTY host，新建、重连、重启的进程先按显示算；旧守护进程忽略这条请求。同机交替跑 main 和本分支各两轮（load 3.8–7，测试自己就把 load 推过 4）：K = 10 输入延迟 p95 从 418 / 422 ms 降到 58 / 60 ms，K = 3 为 19–24 → 23–24 ms，安静 18–19 ms 不变；刷屏写完 K = 10 为 12.5–12.6 → 11.5–14.7 s，K = 3 为 3.5 → 4.3–4.4 s。按 review 调高隐藏下限后再测一轮（load 3.6–4.0）：K = 10 p95 51 ms、K = 3 p95 20 ms，吞吐 34 MB/s
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

- [ ] 启动画面和欢迎页入场在作者的机器、真实档案和打包后的 app 上的观感（PRD v1.98）：细点能不能看清、聚拢的节奏、黑框是否真的没了
- [x] 在应用里运行 `vim`、`htop`、`less`（2026-10-20，`tui-apps.spec.ts`：vim、less、top 通过；本机没装 htop，那个用例自动跳过）
- [ ] 真实桌面：关闭按钮隐藏窗口、Dock 恢复；⌘Q 后 agent 继续运行；⌥⌘Q 弹出确认。逻辑已由 `lifecycle`、`quit-keeps-agents`、`menu-keys` 覆盖，剩清单 B：全屏下关闭、原生确认框的样子
- [ ] 系统通知、点击通知跳转、Dock 角标。主进程的真实链路已由 `notifications.spec.ts` 覆盖，剩清单 D：横幅的样子和通知权限
- [ ] 玻璃外壳在不同壁纸上的观感、侧栏 / 右侧栏开合动效的手感（只能人工，清单 E；原「侧栏毛玻璃开 / 关」已没有开关）
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
- 终端在尺寸回调里同步补画（`xterm-surface.ts` 的 `paintNow`）调用 RenderService 的 `_renderRows`。升级 xterm 时用 `e2e/terminal-flicker.spec.ts` 复测。
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
| 派活与回报（F21）：确认条、侧栏子会话和连线、会话头“由 … 派出”（Figma 第 40 节）；总览“派出的会话”、待送报告条照 11 v2 / 脚本条现有样式 | 第三批 | 已设计并实现（2026-10-29，PRD v1.99） |
| 30 已合并的 worktree · 合并面板只写结果（30A–30G，含浅色） | 合入链路 | 已实现（2026-10-27） |
