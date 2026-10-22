# SPEC — Wavi film C, "One task, three answers"

```text
GOAL:    a developer who already runs several agents thinks "I could hand this one task to three of them and keep the best",
         and downloads Wavi.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, English on screen, no voice, sound effects only (music not chosen yet).
TIME:    38.5 s x 30 = 1155 frames. Grid 120 BPM = 15 frames a beat (no track sets the clock yet).
LOOK:    ground #050505; ink #ededed, secondary #a1a1a1, tertiary #6b6b6b, hairline #ffffff1c.
         The git graph is the world and the carrier: main #a1a1a1, lanes in the app's lane palette
         (lane 1 #c79bff, lane 2 #6ccfd6, lane 3 #ffb224), commits as dots with a ground-coloured ring.
         Status colours only for status: running #5ea1ff, done #3dd68c, failed check / conflict #ff5c5c,
         and one accent #ff5fb0 only on the lane that waits on you.
         Display: Wavi Archivo (site subset) 900, width 100 %, -2 % tracking, titles 80-88 px, one line on screen at a time.
         Product UI rebuilt at 2x: terminals and the Compare view in JetBrains Mono 26/40 px and Inter; no tilt, no glass.
OBJECTS: the task card: "> Get checkout's first paint under 2s" in JetBrains Mono on #121212 with a 3 px #ffffff1c border,
         sitting on main where the three branches fork.
         Worktree terminal (one per lane): header = status glyph, who ("Claude Code 1" / "Claude Code 2" / "Codex"),
         branch (jacob/checkout-lcp-1..3); body = the site's replica output (site/src/scripts/data.ts ATTEMPTS):
         Claude ⏺ green / Codex • orange #e08a5e, check results, "First paint 2.8s → 1.6s / 1.9s / 2.1s".
         Conflict radar: the site's clash marker, a red dashed line between two lanes, a ring with "!",
         "conflict: checkout/page.tsx".
         Claude permission prompt in lane 2 ("Bash command" / pnpm test checkout / Do you want to proceed?).
         Compare view: the site's compare view (head "Compare", the task, "based on main · 3 attempts"; per pane: glyph,
         who, branch, "+add −del · N files", check chips, last output lines, "View diff" / "Merge this";
         "Merged" / "Archived" badges; "Merged jacob/checkout-lcp-1 · archived the other 2").
         Cursor: macOS arrow, 72 px tall (6.7 % of the frame), white with a 3 px black edge.
         End card: the site's WAVI mark as SVG, chrome gradient over an RGB fringe; the merged lane draws its underline.
MOTION:  camera moves power2.inOut 0.7-1.0 s with 10 px blur at the fastest frame; arrivals expo.out; exits power3.in 0.15-0.2 s;
         terminal lines print instantly (a terminal does not fade), 0.17-0.3 s apart; titles per word blur 6 -> 0 in 0.13 s,
         0.067 s apart, dead still once landed.
SHOTS:   (one continuous take on the graph from f0 to f630; the camera never cuts)
  1  take     f0-96      the task card on main; three branches draw out of main (0.6 s) and copies of the card ride up them;
                         "One task," then "several answers." below main.  sound: whoosh on the fork
  2  take     f96-234    camera travels to lane 1 (s 0.55 -> 1): Claude Code 1's terminal prints its run, checks pass,
                         "First paint 2.8s -> 1.6s"; lane head turns done.  sound: typing under the print
  3  take     f234-309   camera to lane 2: Claude Code 2 reads, writes worker/price.ts, edits checkout/page.tsx.
  4  take     f309-366   camera eases out (s 0.62) so lanes 1 and 2 share the frame: the conflict radar flashes between them,
                         "conflict: checkout/page.tsx".  sound: low glitch
  5  take     f348-444   lane 2 stops on a permission prompt: its head and note turn magenta ("needs you"); camera back in;
                         keycap 1 "Answer it"; it carries on: tests pass, tsc 2 errors, 1.9s.  sound: pop on magenta, key on 1
  6  take     f444-540   camera to lane 3: Codex explores, splits the bundle, tests and tsc pass, 2.1s.
  7  take     f549-630   camera pulls back over all three lanes (s 0.3); the graph lines fade, the three terminals stay.
  8  compare  f630-840   the three terminals become the three panes of Compare (morph 0.7 s); checks; the cursor clicks
                         "Merge this" on Claude Code 1: Merged; the other two: Archived; the head reads
                         "Merged jacob/checkout-lcp-1 · archived the other 2".  sound: whoosh, pops, click
  9  rise     f840-1020  blur swap back to the graph from above; lane 1 merges into main (payoff), lanes 2 and 3 dim;
                         "Merge the best one." then "Archive the rest."  sound: impact on the merge
 10  end      f1020-1155 a lane curves into main under where the mark will be; WAVI wipes in above it;
                         "Download for macOS", "Free · open source · no telemetry"; hold 2.9 s.  sound: pop, bass hit on the mark
BANNED:  a dark void with small UI floating in it (terminals and Compare are at 2x and fill >= 45 % of the frame);
         glow, bloom, particles; purple/blue gradients; glass cards; tilted or 3D UI; everything fading and sliding up;
         three cards in a row as a feature list (the Compare panes are the product's own view, not cards);
         a title over a dimmed screenshot; the logo in a corner; typing into a prompt box as the opener;
         invented UI or numbers presented as measured.
QA:      f0 (thumbnail: task card on main, never black) · f80 ("several answers." readable) · f190 (terminal 1 readable) ·
         f340 (conflict marker and label readable) · f390 (lane 2 magenta, prompt readable) · f610 (overview) ·
         f720 (Compare readable) · f800 (Merged / Archived) · f940 (merge into main, title) · f1140 (end card).
```

## Notes

- Copy is the site's own: "One task, several answers.", the task, the replica output, the Compare strings, "Merge the best one" and
  "archive the rest" (from the compare lead, split into two lines of at most six words), "Download for macOS", "no telemetry".
- "First paint 2.8s → 1.6s / 1.9s / 2.1s" and every number in the terminals are the site's illustrative replica data, not measurements.
- The conflict file (checkout/page.tsx) is taken from what the two attempts touch in the replica (Claude Code 1 reads it, Claude Code 2's
  diff edits it); the permission prompt in lane 2 is added for the story.
- The app's UI is Chinese today; the English labels follow the English site's replicas.
