# SPEC — Wavi launch film F, "一个想法，多线程"

```text
GOAL:    a developer who runs several agents feels "one idea, many threads, one person ships it" and downloads Wavi.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, Chinese on screen (every line is a variable).
TIME:    40 s x 30 = 1200 frames. 120 BPM = 15 frames a beat, 60 a bar: "do robots have a god?" (smilingcynic,
         CC BY 3.0) from 6.56 s into the track, so its first downbeat after the quiet intro lands on the burst (f45).
         Scenes are authored in film seconds (no SPEED wrapper). Built by tools/build-film.mjs; edit that, not the HTML.
         Rendered with --resolution 4k (Chrome at 2x DPR, --browser-gpu) and scaled to 1080p with lanczos: 2x supersampling.
LOOK:    ground #050505 with the site's grain at 4 % in shots 1-2 and 6 only; product ground #0a0a0a;
         ink #ededed, secondary #a1a1a1, tertiary #6b6b6b, hairline #ffffff12.
         One accent #ff5fb0 only on 「叫你」 in the end card and on a row that needs you.
         Status colours as the app uses them, never decoration: running #5ea1ff, done #3dd68c, error #ff5c5c,
         Codex lane #b794ff, remote lane #e08a5e.
         Type: UI is Inter + Wavi Sans SC (Noto Sans SC subset, OFL) and JetBrains Mono at the app's sizes; the window is
         built at 2x (2880 x 1800 world) and framed at 0.6 (whole window, 1.2x) to 1.0 (2x). Titles: Wavi Sans SC 900,
         150-190 px, -2 % tracking, one line on screen at a time. Mark: the site's WAVI (Archivo 900, width 125 %).
         Depth: shot 1 is real 3D (perspective 1400 px); shot 4-5 is the UI lying down as a floor (see BANNED).
         No shadows over 0.5 opacity; the only glass is the app's own shell.
OBJECTS: "?": the site's hero glyph, Wavi Archivo 900 at 400 px, chrome fill, blue / red / yellow fringe,
         scanlines every 14 px; the same glyph as the end card's ten.
         The window is the app's glass shell (PRD §5, Figma 28E split / 28H split + right panel), 1440 x 900, radius 12,
         --glass-shell #1e1e20 at 62 % over the film's black, a 1 px light edge. No dividers anywhere.
         Sidebar (264): traffic lights, the panel toggle, 打开项目… ⌘O / 跳转到… ⌘K / 总览 ⇧⌘A, projects acme-web (4) and
         terminal-reborn (2) with Figma 28E's sessions, 设置 ⌘, at the bottom. SessionRow 11:51: glyph · title / activity /
         agent mark + short branch, time / diff; selected = bg/selected, shown in another pane = 1 px border/default.
         Panes: a 44 px header on the glass (title 15/600; the focused pane alone carries paperclip · globe · git-branch ·
         git-fork · folder, then … ×), a terminal card below it (radius 10, #0a0a0a, --card-edge), 6 px between cards and
         from the window's right and bottom; a 2 x 32 grip in each gap. The CLI sits at the card's bottom with its prompt
         box and footer (Claude: auto mode on; Codex: context left); copy from Figma 28E / 28H.
         Drag (Figma 21D): the row steps back to 40 %, a DragGhost pill (glyph + title) rides 14 / 16 off the pointer, the
         DropTarget is a 2 px #5ea1ff ring with bg/selected and the hint 松开在这里显示这个会话.
         Git panel (Figma 13B in a 28H card, 480 wide): header Git · acme-web · ↻ … ×, 图谱 / 变更 3 segments, 全部分支;
         graph-model numbers: rows 28, lanes from 18 every 17, 2 px lines, turns of radius 8, nodes 4 with a 2 px cut,
         GraphRef pills in the lane colour (dashed for remotes). With the panel open the tools sit at the window's top
         right with the context and plan chips.
         Cursor: the macOS arrow, 96 world px (58-96 px on screen), white with a black edge.
         CRT end card: the site's hero (WAVI mark, ten "?", 一个人，多线程。, sub, 下载 macOS 版 / GitHub ↗, note).
MOTION:  enter expo.out 0.5 s; move/camera power2.inOut 0.5 s; exit power3.in 0.25 s; burst power4.out 0.8 s.
         Moves carry 8-16 px blur at their fastest frame. Row stagger 0.05 s. Landed titles are dead still.
         The cursor moves on power2.inOut, 0.35-0.5 s per move; its click causes the next thing on the same frame.
SHOTS:
  1  idea    f0-150    the site's chrome "?" on the grain; two pulses on the beat (f15, f30); on f45 it bursts and
                       ten session rows fly out of it in 3D, tumbling, blurred at their fastest.  sound: hum, burst
  2  order   f150-300  the rows brake, turn flat and drop into their slots one by one (0.05 s): a centred sidebar,
                       two projects, six rows, spinners turning.  sound: a tick per row
  3  split   f300-600  the sidebar docks left and the window builds round it; the cursor enters, the camera leans in at 2x.
                       click 「Cookie 会话迁移」: the row morphs into the terminal. Then it drags 「结算页性能优化」,
                       「修复移动端导航抖动」, 「侧边栏状态聚合」 right into the terminal area; each DropTarget says 松开在这里显示这个会话;
                       the camera follows each drag, then pulls back to the whole window on black.  sound: click, drag, drop thunk
  4  git     f600-840  the cursor clicks the git-branch icon top right; the 图谱 panel slides in. The whole window tips back
                       70° into a floor and the graph stretches into a runway; the camera runs along it, commits pass
                       under it faster and faster.  sound: riser, a tick per commit
  5  ship    f840-990  ahead, the five lanes fold into main one after another (5 merges in 1 s); the camera rises to look
                       down on the last node; the tag 「v1.0.0」 drops onto it; 「上线。」 lands beside it.  sound: impact
  6  end     f990-1200 hard cut to the CRT: the ten "?" switch on, WAVI wipes in, 「一个人，多线程。」, the sub,
                       下载 macOS 版 / GitHub ↗, 免费开源 · macOS 13+ · Apple 芯片与 Intel; hold 2.5 s.
BANNED:  a dark void with small UI floating in it (shot 1 rows are >= 25 % of the frame width up close; from shot 2 the UI
         fills >= 45 % of the frame); glow, bloom, lens flares, decorative particles; purple or blue gradients, glass
         cards of our own (the app's shell and cards are the product); everything fading and sliding up; three cards in a row; a title over a dimmed screenshot; a logo
         docked in a corner; typing into a prompt box as the opener; click rings; invented UI or numbers presented
         as measured. Tilted UI is allowed only in shot 4-5 (the floor), asked for by the person; nowhere else.
QA:      f0 (thumbnail: the "?" fills 33 % of the height) · f90 (burst: rows readable up close) · f270 (the list,
         six rows) · f525 (three panes + a drag) · f750 (the runway) · f960 (v1.0.0, 上线。) · f1185 (end card).
```

## Notes

- Copy is the site's own wherever it exists: 一个人，多线程。, 给同时跑好几个 Claude Code 和 Codex 的个人开发者。,
  agent 各干各的，只在需要你时叫你。, 下载 macOS 版, 免费开源 · macOS 13+ · Apple 芯片与 Intel, the replica sessions.
- The split is the app's real F20 interaction: a sidebar row dragged into the terminal area; at most four panes.
- Session data, commit subjects and v1.0.0 are illustrative story data, not product measurements.
- Key frames for review live in `boards/` (stills at 3.0 / 9.0 / 17.5 / 25.0 / 32.0 / 39.5 s), posed by
  `tools/gen-frames.mjs` into `compositions/frames/`; `boards/.posed.html` is the root that mounts them.
- Scenes: idea (shots 1-2, 0-10 s) · app (shot 3, 10-20 s) · git (shots 4-5, 20-33 s) · end (shot 6, 33-40 s).
  Shots 1-2 and 4-5 share a scene so the same elements carry across without a cut; idea→app and app→git are
  frame-identical cuts.
