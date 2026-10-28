# Review — v2: the glass shell, supersampled (2026-10-28)

## What the author flagged in v1, and why it happened

- The window was the 10-22 dark rebuild from film A (hairlines between panes and under headers, a black sidebar), not
  today's design. Shots 3-5 were never checked against Figma: PRD §5 has made the window the glass shell since v1.73.
- Rough edges: v1 averaged 4 Mbps (1.2 Mbps in shot 3) in yuv420p, so text went soft and coloured strokes lost half
  their resolution; 3D-tilted layers rendered without anti-aliasing (software GPU fallback in the sandbox). Measured by
  comparing lossless snapshots with frames pulled from the MP4 at 3x zoom.

## What changed

- Shots 3-5 rebuilt from Figma 28E (split), 28H (split + right panel), 21D (DragGhost, DropTarget, DropHint) and 13B
  (Git graph), with the numbers from the app's own CSS: glass shell, sidebar nav and 设置, cards 6 apart with the card
  edge, headers on the glass, tools only on the focused pane and at the window's top right once the panel is open,
  the CLI at the bottom of each card with its prompt box, Figma's own terminal copy, graph-model's lanes and turns.
- The window sits whole on the film's black at 0.6 (1.2x) with push-ins to 1.0 (the click) and 0.66 (each drag).
- Shot 5 now folds five lanes into main on five merge rows, as the real graph draws merges.
- A layout bug found on the way: the CLI is a bottom-anchored flex column, and when a pane narrowed its lines shrank
  and overprinted each other; every line is now `flex: none`.
- Rendering: `--resolution 4k` (Chrome at 2x device pixels) with `--browser-gpu` and delivery quality, then lanczos
  down to 1080p; both files are delivered.
- The storyboard stills in boards/ still show the v1 window; the film is the reference now.

## Measured

- `check`: 0 errors (warnings as in v1: small UI text by design, rows in flight, blur count, repeated agent marks).
- Seams idea→app and app→git are frame-identical (seam sheets).
- renders/f-one-idea-v2-4k.mp4: 3840 x 2160, hardware GPU, 14.6 Mbps. renders/f-one-idea-v2.mp4: lanczos to 1080p,
  x264 CRF 14 slow, 3.9 Mbps average (8.4 Mbps on the runway). -16.3 LUFS, -1.4 dBFS peak, sound measured, not heard.
- At 3x zoom against v1: slab edges and tilted lanes are anti-aliased, the block artefacts around text are gone.
- Not done: the light theme, and the context / plan chips' numbers are Figma 28H's illustration values.

# Review — first cut (2026-10-28)

## Creative calls

- Built storyline F, "一个想法，多线程" (40 s, 16:9, Chinese, no voice), from the six key frames the author approved.
- Four scenes, two of them holding two shots each so the same elements carry across without a cut: idea (shots 1-2),
  app (shot 3), git (shots 4-5), end (shot 6). idea→app and app→git are frame-identical cuts (checked on the seam sheets).
- Changes from the approved stills, all for continuity:
  - The sidebar counts read 3 / 3 (six rows fit at 2x); the other four burst rows sweep down out of frame.
  - Shot 5 has main on the left with the lanes curving in from the right, because the runway is the git panel's own
    graph and main is its leftmost lane. The still had main in the middle.
  - The run's last node stops near the floor's hinge, so the floor can stand up without the node leaving the frame.
- The split is the app's real F20 interaction: a sidebar row dragged into the terminal area, drop zones that say 显示,
  the moved row stepping back to 40 %, panes split by hairlines; the panel icons sit only on the focused pane, so the
  cursor clicks the top-right pane before it clicks git-branch.
- Tilted UI appears only in shots 4-5, as the author asked; SPEC lists it as the one exception.
- Music: the A/B/C track ("do robots have a god?", smilingcynic, CC BY 3.0, credit in assets/sfx/CREDITS.md), entered at
  6.56 s so its quiet intro sits under the "?" and the beat drops on the burst at 1.5 s; muffled (lowpass 700 Hz) until
  then. 35 effects from the bundled Pixabay set, each placed so its measured peak lands a frame after its picture.

## Measured vs looked at

- `check`: 0 errors. Warnings kept on purpose:
  - `text_below_floor`: sidebar and terminal text is the app's UI at 2x, then 1.5x once four panes are on screen; it is
    texture there, not copy. The lines meant to be read (上线。, the end card) are 150-190 px.
  - `line_unread`: rows in flight during the burst and the landing; nobody reads them there.
  - `composition_heavy_overlay_count_high`: the motion blur on the ten flying rows.
  - `duplicate_media_discovery_risk`: the agent marks repeat per row by design.
- Looked at: snapshots across every shot, the seam sheets (0.2 s either side of each cut), the phone sheet (the claim and
  the download button read at 360 px; sidebar rows do not, and do not need to).
- Sound: measured, not heard. renders/f-one-idea-v1.mp4 (40.0 s, 1920x1080, H.264 + AAC) is -16.3 LUFS integrated,
  5.3 LU range, -1.5 dBFS peak. Frames pulled from the file at 3 / 9 / 17.5 / 25 / 31.5 / 39.5 s match the snapshots.

## Weakest shot

- Shot 4's run leans left: the vanishing point sits over the panel's centre while the lanes are on its left edge, so the
  lanes run diagonally. It reads as speed, but a centred runway would be calmer; with more time, move the perspective
  origin over the lanes and widen the floor with the dimmed window lying beside it.
- Shot 1 has no sound between the second pulse and the burst other than the whoosh's build; a short tube-hum bed under
  the "?" would make the opening less empty.

## Open

- The render needs Chrome outside the sandbox for the music's audio FX (lowpass, limiter).
