# SPEC — Wavi launch film (storyline A, "The one that's waiting")

```text
GOAL:    a developer who runs several agents thinks "that's me, one of mine is stuck right now" and downloads Wavi.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, English on screen (every line is a variable; a zh cut swaps them).
TIME:    40 s x 30 = 1200 frames. Grid 120 BPM = 15 frames a beat, 60 a bar, until a real track sets the clock.
LOOK:    ground #050505 (the app's sidebar black) with the site's grain at 4 % in the wall and type worlds only;
         product ground #0a0a0a; ink #ededed, secondary #a1a1a1, tertiary #6b6b6b, hairline #ffffff12.
         One accent #ff5fb0 ("waiting on you"), only on: the stuck prompt's age, the waiting row, the ten "?".
         Status colours as the app uses them, never decoration: running #5ea1ff, done #3dd68c, error #ff5c5c.
         Display: Wavi Archivo (site subset) 900, width 125 %, -2 % tracking; titles 96-120 px (9-11 % of height),
         one line on screen at a time. Payoff lines: Wavi Bodoni (site subset) 400, 200 px caps.
         Product UI: Inter (bundled stand-in for SF Pro) and JetBrains Mono, rebuilt from the app at 2x
         (13 px UI text -> 26 px; terminal 13 px -> 26-30 px). No window shadows over 0.5 opacity, no tilt, no glass.
         Light and depth: none; flat UI on flat ground, the CRT end card is the only "material".
OBJECTS: terminal pane: 1 px #ffffff1c border, a dim header "<dir> — claude|codex", streaming Claude (⏺ green)
         or Codex (• orange #e08a5e) output in JetBrains Mono.
         Claude permission prompt: "Bash command" / command / "Do you want to proceed?" / ❯ 1. Yes / 2. Yes, and
         don't ask again… / 3. No, and tell Claude what to do differently (esc).
         Wavi sidebar: project header (name + count), SessionRow = status glyph · title / activity · time / diff,
         copy from the site's English replica (site/src/scripts/data.ts).
         Status glyph: the app's SVG (running arc, needs-you dot with halo, done dot, error dot, idle ring).
         macOS notification banner: rounded 18 px, #1e1e1ef2, app icon, "acme-web · Session cookie migration",
         "Confirm: pnpm prisma migrate dev", "now".
         Keycap HUD: the real shortcut (⌘J, 1, ⇧⌘M) as keycaps 88 px tall, #161616, 1 px #ffffff2e, with the verb
         beside it in Inter 500 34 px; pressed = moves down 4 px and fills #ededed for 3 frames.
         Merge sheet: the app's merge sheet, flat (no glass): "Merge session-cookie into main", checks
         "No conflicts" / "Tests passed", methods Merge · Squash · Rebase, primary "Merge".
         Git graph: the site's 8-lane graph (GRAPH in data.ts), lanes in status colours, commits as 10 px dots.
         CRT tube: black glass, scanlines every 4 px at 22 %, RGB fringe (-3 px blue, +3 px red), the ten "?".
MOTION:  enter expo.out 0.5 s (15 f); move/camera power2.inOut 0.5 s; exit power3.in 0.25 s; zoom-through
         power3.in 0.35 s. Moves carry 8-16 px blur at their fastest frame. Word stagger 0.07 s; row stagger 0.05 s.
         Springs: none on UI. Landed titles are dead still.
SHOTS:
  1  wall    f0-60     4x2 wall of streaming terminals fills the frame; pane 6 (cookie) does not move.  sound: room tone, keys
  2  wall    f60-165   focus outline hops ⌘1→⌘5 on the beat, each pane still busy; keycap HUD shows ⌘1…⌘5.  sound: key tick per hop
  3  wall    f165-225  camera punches into pane 6 (2.6x, 0.5 s): the prompt, "waiting 23m" in magenta beside it;
                       title "It waited 23 minutes." under the prompt.  sound: bed drops to near silence
  4  wall    f225-300  the eight panes fold into eight sidebar rows (morph 0.6 s, stagger 0.05 s);
                       hands off to the app stage with the sidebar at its final place.
  5  app     f300-405  sidebar (2x) left; the cookie row is the only magenta; notification slides in top-right;
                       title "Only the one waiting on you lights up." right of the sidebar.  sound: notification, bed opens
  6  app     f405-510  keycap ⌘J; selection jumps to the cookie row; the row widens into its terminal (morph),
                       which shows the prompt at 2x.  sound: key, whoosh-short on the morph
  7  app     f510-585  keycap 1 "Answer"; the prompt resolves, the agent prints its next steps, row turns running.
  8  app     f585-675  output races; row turns done "Done, ready for review"; the Changes panel slides in with the diff.
  9  app     f675-780  keycap ⇧⌘M "Merge"; the Merge button morphs into the merge sheet; checks tick; Merge -> "Merged".
                       zoom through the merge dot into the graph.  sound: click, pop per check, whoosh
 10  graph   f780-990  the graph: cookie lane lands on main, camera pulls back to all eight lanes merging in turn;
                       "BRANCH OUT." then "MERGE IN." in Bodoni above the lanes.  sound: riser into impact on the last merge
 11  claim   f990-1065 hard cut on the beat: "One person, many threads." per word, ink on #050505 with grain.
 12  end     f1065-1200 CRT tube: ten magenta "?" flick to "·" one by one (0.07 s apart), the row collapses into the
                       WAVI wordmark; "Download for macOS" button and "Free · open source · no telemetry"; hold 2.5 s.
BANNED:  a dark void with small UI floating in it (the UI fills >= 45 % of the frame or is cropped by the camera);
         glow, bloom, particles, lens flares; purple or blue gradients, glass cards; tilted or 3D UI;
         everything fading and sliding up; three cards in a row; a title over a dimmed screenshot;
         a logo docked in a corner; typing into a prompt box as the opener; click rings; breathing/pulsing loops
         on titles or UI (the running spinner is the product's own); invented UI or numbers presented as measured.
QA:      f0 (thumbnail: the busy wall, not black) · f200 (prompt + "It waited 23 minutes." readable) ·
         f290 (sidebar formed, matches f300) · f360 (one magenta row, title readable at 360 px) ·
         f470 (prompt in Wavi's terminal) · f640 (diff readable) · f740 (Merged) · f900 (graph, BRANCH OUT.) ·
         f1030 (claim) · f1190 (end card: WAVI, Download for macOS).
```

## Notes

- Copy is the site's own wherever it exists: "Only the one waiting on you lights up.", "One person, many threads.",
  "BRANCH OUT. / MERGE IN.", "Download for macOS", "Free, open source, no telemetry", the replica sessions.
- "It waited 23 minutes." and the session data are illustrative story data, not product measurements.
- The app's UI is Chinese today; the English labels follow the English site's replicas. The zh cut uses the real labels.
