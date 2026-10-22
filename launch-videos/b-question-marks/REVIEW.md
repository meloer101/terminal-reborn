# Review — film B

## 1.5x cut with music (2026-10-22)

- Plays at 1.5x, as film A: each scene is authored at 1x and wrapped in a parent timeline with `timeScale(SPEED)`;
  clip times in the HTML are film times, tween positions are written as `F(film seconds)`. Film is 22.5 s
  (SPEC.md's shot list is the 1x cut; the film-time hits are below).
- Music: the same track as A for one sonic identity, "do robots have a god?" by smilingcynic (ccMixter, CC BY 3.0,
  120 BPM; credit in assets/sfx/CREDITS.md), entered on a beat at 16.045 s of the track (inside its full-energy section,
  bars at -14 to -15 dB). Muffled (lowpass 1200 Hz) and lower in the tube, opens on J at 3.5 s; limiter last; 1.2 s fade-out.
- Hits on the music's beats: J 3.5 · cut into the row 4.5 · answer 6.0 · done 7.0 · cut into the graph 8.5 ·
  ⇧⌘M 9.5 · merge dot lands 10.0 · cut into the tube 11.5 · nine answers on sixteenths 12.5-13.5 · ALL RUNNING 14.0 ·
  switch-off 15.0 · BRANCH OUT. 15.5 · MERGE IN. 17.0 · WAVI 18.5 · Download for macOS 19.5 · end 22.5.
  One beat of hold was added in the row so "Confirm: pnpm prisma migrate dev" reads before it is answered.
- Every SFX retimed to picture + 1 frame − measured peak; the MERGE IN. impact sits on its own track (13).
- Mix measured, not heard: project render -16.9 LUFS / -1.5 dBTP; renders/wavi-b-1.5x.mp4 is two-pass loudnormed to
  -14.7 LUFS, -2.0 dBTP, no clipping; duration 22.500 s = root data-duration.
- Kept warnings: "Jump to it" (keycap, ~0.95 s), "Running pnpm test auth" (transient state, 1 s), the WAVI fringe
  contrast (decorative layer), BRANCH OUT. / MERGE IN. (per-letter false positive).

## First cut (2026-10-22)

## Creative calls

- A 24.5 s teaser built on the site's CRT tube. The carrier is the dot of a "?": J dives into it, it becomes the
  needs-you glyph in the sidebar, is answered (running → done), becomes session-cookie's head node, rides the merge
  curve into main as the merge dot, and lands back in the tube as the first answered mark. Answering a "?" removes its
  hook and keeps its dot, so "answered" is the same shape all the way through.
- Every world change is a match cut on that dot: zoom in power3.in 0.5 s to a 280 px dot at frame centre, the next
  scene starts from a 280 px dot at the same place and pulls back expo.out 0.8 s. The "?" dot is drawn (52 px circle at
  the measured position of Archivo's dot) over a cover, so it can change colour and survive the hook.
- The ending comes out of the tube: it switches off after ALL RUNNING, the Bodoni lines play on grain, and the tube
  switches back on with the WAVI mark on its screen (film A puts the mark above the tube).
- Copy: "Ten agents. / Waiting on you." (from the site's hero caption), keycap verbs "Jump to it / Answer it /
  Merge it", the site's "BRANCH OUT. / MERGE IN.", "ALL RUNNING", "Download for macOS", "no telemetry".
  Session and graph data are the English site's replica data; the app's UI is Chinese.
- No music yet; 16 sound effects from the bundled Pixabay library.

## Measured vs looked at

- `check`: passes, 0 errors. Warnings kept on purpose:
  - `contrast_aa_failure` on the WAVI mark: the black text layer inside the fringe group, decorative; the chrome
    layer on top is the one read.
  - `line_unread` "Jump to it" (0.8 s on screen): a keycap label read at a glance, as in film A; lengthening it would
    push the first match cut past 4.5 s.
  - `line_unread` "Running pnpm test auth" / "Done, ready for review": transient row states; the glyph colour carries them.
  - `line_unread` "BRANCH OUT." / "MERGE IN.": a false positive, the checker counts each printed letter as a word;
    each line holds 1.5 s.
- Looked at: the beat sheet, all five seams, every match cut frame before and after (3.97/4.03-style pairs), the phone
  sheet (titles, keycaps, tube and ALL RUNNING read at 360 px; the graph labels do not).
- Fixed in review: ALL RUNNING wrapped to two lines (140 px, no wrap); keycap fills showed pressed before the press
  (immediateRender); an empty frame at both type cuts (first letter now on from the cut); the opening lines and J were
  too short to read, so the tube scene grew to 4.5 s and the film to 24.5 s.
- Sound: placed by measured peaks, one frame after the picture. Nobody has heard the mix.

- Coordinator review (P1, "small UI floating in a dark void"), fixed: the row section is now 3.6x the app
  (1368 px, 71 % of the frame) through all three states, keycap below it at the tube shot's scale; the graph was
  re-laid out to span 88 % of the width (lanes y 220-640, main at 760) with the merge landing at x 960.

## Weakest shot

- The graph (8.5-12.5 s): the merge is one short curve; the node's ride into main is quick (0.5 s).
  With more time: hold the camera closer on session-cookie during the ride, then pull out.
- The row scene's halo fades in during the pull-back, so the first frames after the cut show a soft magenta ring
  wider than the tube's dot.

## Open

- Music (the whole teaser is built for a 120 BPM track; seams sit on beats).
- zh cut: the replica labels and the two opening lines.
- Note for film A (not changed here): A's keycap `press()` uses `fromTo` without `immediateRender: false`, so its
  keys show the pressed fill from the moment the HUD appears until the press.
