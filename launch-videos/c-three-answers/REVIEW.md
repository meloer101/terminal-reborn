# Review

## 1.5x cut with music (2026-10-22)

- Plays at 1.5x: each scene keeps its 1x authoring on a 0.75 s grid and is wrapped in a parent timeline with `timeScale(SPEED)`; clip times in the HTML are already divided by 1.5. Film is 31.5 s (take 0-18, Compare 18-23, rise 23-28, end card 28-31.5).
- Music: the same track as film A, "do robots have a god?" by smilingcynic (ccMixter, CC BY 3.0, 120 BPM; credit in assets/sfx/CREDITS.md), from section C at 64.045 s (a beat at t=0; calmer than A's section, and the B section returns at ~26 s, under the merge and end card). Limiter last; volume 0.6, dips to 0.45 under the conflict and the wait, opens to 0.75 on the answer; 1.5 s fade-out.
- Hits on beats: fork 0.5, Claude Code 1 result 6.0, conflict 9.0, needs you 11.0, answer 12.5, Claude Code 2 result 13.5, Codex result 16.0, Compare morph 18.0, Merge this 20.0, Archived 20.5, merge into main 24.0, end mark 28.0. Two beats were added to Compare's result and one to the end card so they hold at 1.5x.
- Mix measured, not heard: renders/wavi-c-1.5x.mp4 is loudness-normalised (two-pass ffmpeg loudnorm) to -14.7 LUFS, -1.6 dBTP, no clipping; duration 31.5 s.
- Kept warnings: `line_unread` on terminal lines, the permission prompt (1.5 s on screen) and "Merged jacob/checkout-lcp-1 · archived the other 2" (2.1 s; the badges carry it); titles all pass.

# Review — film C, first cut (2026-10-22)

## Creative calls

- Storyline C from ../STORYLINES.md: 38.5 s, 16:9, English, no voice, effects only. One continuous camera take over the git graph
  from frame 0 to 21 s (the task card on main, three branches, each worktree's terminal, the conflict radar, the wait), then the
  three terminals morph into the Compare view, a blur swap back to the graph for the merge, and an end card whose underline is the
  merged branch curving into main.
- All terminal text, check results and "First paint 2.8s → 1.6s / 1.9s / 2.1s" come from the site's replica data (illustrative).
  Added for the story: Claude Code 2's `Update(checkout/page.tsx)` line (its replica diff edits that file), the permission prompt in
  lane 2, and the conflict file name.
- Copy: "One task, several answers." (site h2), "Merge the best one." / "Archive the rest." (the site's compare lead cut in two),
  Compare's own strings, "Download for macOS", "no telemetry".
- Lane colours are the app's lane palette (#c79bff, #6ccfd6, #ffb224); green/red/blue/magenta only for status.

## Measured vs looked at

- `check`: 0 errors. Warnings kept on purpose:
  - `line_unread` on terminal lines (each terminal's last lines hold 0.4-0.9 s before the camera moves on; the same results are
    re-read in Compare for 6 s) and on the permission prompt (readable ~1 s at full size, seen 1.9 s in total).
  - `line_unread` on the task card at 0 s (the camera pulls out of it at 0.3 s; it is the thumbnail, read again as each terminal's first line).
  - `text_below_floor` on 26 px branch names and Compare's base line (the app's 13 px mono at 2x).
  - `contrast_aa_failure` on the archived panes' buttons (dimmed to 28 % on purpose) and the WAVI fringe layer.
- Looked at: the beat sheet, all three seams (take → compare is frame-identical), the phone sheet (titles and Compare read at 360 px;
  terminals in the overview do not, by design).
- Sound: 22 bundled Pixabay effects, peaks measured and placed one frame after the picture; nobody has heard the mix. No music.

## Second pass (coordinator notes, 2026-10-22)

- Frame 0: the task card at 71 % of the frame width (56 px text), main and three branch stubs already visible.
- Terminals: the camera sits at 1.2x on each one (1440 px wide, 75 % of the frame, text 31 px); the conflict radar and the
  "needs you" moment are framed at the same scale.
- Compare: the terminals now sit under the panes, so the panes fill while the morph lands (no empty outlines).
- Rise: thicker lines, lanes span 87 % of the width; "Merge the best one." holds 1.75 s and "Archive the rest." 2.15 s, one at a time.
- End card: the mark wipes in from the first frame together with the line.

## Third pass (2026-10-22)

- The conflict radar shows alone (10.8-11.6 s); the permission prompt appears only once the camera is back on Claude Code 2 at 1.2x
  (12.2 s) and is answered at 13.7 s, so it is fully inside the action-safe box for 1.5 s.
- The pull-back is now a 0.8 s move ending at 20.5 s with a 0.5 s hold before Compare; Codex's result holds 1.1 s first.

## Weakest shot

- The rise (28-34 s) is calm; the payoff is one merge curve. A faster camera rise on the merge would give it more weight.
