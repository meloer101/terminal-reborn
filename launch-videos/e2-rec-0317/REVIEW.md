# REVIEW — Wavi film E2, "REC 03:17"

## Creative calls

- One material for the whole tape: every scene paints a 2D canvas (the screen) and a blood field, and one WebGL pass
  (`assets/lib/rec.js`) is the camcorder: green grade, chroma offset, grain, interlace, autofocus hunts after zooms,
  head-switching band, rewind tears. Not D1's barrel tube, not D2's VHS channel OSD.
- Blood is a stateless metaball field (`assets/lib/blood.js`): drips swell, run in surges and near-stops (closed-form
  in age), leave thinning trails, merge into pools with a meniscus at each pane wall and ripple on impact; letters melt
  into it. Because it is closed-form, "the blood runs back up into the text" is the same function on a clock that runs
  backwards (3.4x), and the rewind is act 1 painted at a decreasing time.
- One tempo grid (Nightmares, 117.99 BPM, bar 2.034 s) for all 25 bars; act 1 has no drums but cuts on the same bars,
  so the bed slams in exactly on the fold (26.443).
- The cursor is the wound: a block cursor after "Do you want to proceed?" bleeds one drop per blink, and each blink is a
  drip on the soundtrack; at the bleed the cursor itself turns to blood.
- Red is only blood: the REC dot is white; UI error red and red states are absent; the grade turns the terminal's own
  orange and green into camcorder green. Magenta passes through the grade only in the Wavi act.
- "AGENTS RUN AFTER ⌘Q" is staged literally: ⌘Q quits the window, the eight running glyphs stay and keep spinning,
  under the Lovecraft couplet. The end card is the only ungraded, clean picture: the sky WAVI fills from the bottom like
  the flood, redeemed.
- Not built: E1 (one head, many arms) and E3 (the Necronomicon folio), see the E storylines.

## Measured / looked at / not checked

- `npx hyperframes check --json`: ok, no errors (warnings below).
- `snapshot --review`: beat sheet, four seam strips, phone sheet; plus full-resolution stills at 0, 5.5, 11, 13.5, 16,
  18.4, 21, 27.9-32.2, 39.5, 45, 47.8, 50.5 s.
- The delivery render (`renders/e2-rec-0317.mp4`, git-ignored): 50.867 s, 1526 frames, 1920 x 1080, 30 fps, H.264 +
  AAC 48 kHz; 660 MB at `-q delivery` (the tape grain makes it heavy; a `looks` or web encode will be far smaller).
  `npx hyperframes audio`: -14.8 LUFS integrated, -2.0 dBTP, no clipping; silence measured at 20.345-22.41 (the drown,
  as designed) and 26.065-26.455 (the beat between PLAY and the slam); drip onsets every 1.02 s through act 1; the
  music slam at 26.455. Ten frames pulled from the render match the snapshots. The sound was measured, not heard.
- Not checked: playback on a real phone; how the music bed and the chant feel together.

## Notes and fixes (first pass)

- P0 · t=0.0 · wall · the drop under the cursor was ~7 px, invisible in the thumbnail → first drop 9.5 px (world),
  blink drops 6.5-8.5 px · fixed.
- P0 · t=13-17 · bleed · blood read near-black over the dark UI (thick #4a0008) → body #e00f17 → #85030a, clots 70 %
  and sparser, melted letters drawn at 0.8 thickness so they stay bright · fixed.
- P0 · t=11 · chant · every line was already caps chant by the Codex punch-in, so no progression → chant ramps over
  2.7 bars from bar 3.6, 0.2 bar later per pane; the punch-in now reads "• Wgah'nagl fhtagn ph'nglui:mglw'nafh" mixed
  with real lines · fixed.
- P0 · t=31.9 · wavi · after the answer the agent's new lines printed above the pushed-in frame (empty screen) → they
  print in the prompt's place (rows 4-9) · fixed.
- P1 · t=32.7 · "ALL RUNNING." ran off the frame → fitted to 1030 px · fixed.
- P1 · t=28.6-31 · the push-in showed the sidebar's meta column as clutter → 1.6x framed on the main area only · fixed.
- P1 · t=29-31 · the "1 Yes" HUD covered option 3 → HUD at y 860 · fixed.
- P1 · t=31-32 · letters were still red when the prompt resolved → the blood runs back 3.4x (done by 31.7) · fixed.
- P1 · t=20.3-22.4 · the all-red frame read as painted plaster → broad slow swells in the normals and a sheen, fewer
  and larger clots · fixed.
- P1 · couplet small at phone width → 76 px · fixed.
- P2 · camcorder OSD (REC, date) overlaps sidebar text in the Wavi act · kept: it is the tape's burned-in OSD.
- P2 · the sky WAVI's red/yellow fringe on the end card is the one red that is not blood · kept: it is the brand file.

## Weakest shot and what next

- Weakest: the coda (36.6-44.7) is type on a dark ground with eight spinners; it carries the ⌘Q fact but is the
  quietest picture in a loud film. With more time: keep the Wavi window and quit it to the macOS desktop/Dock with the
  Dock badge still counting, and let a last drop retract from the couplet.
- The wall of eight is low-contrast at phone width (text is texture there by design; every read happens in a push-in).
- Push further: a real refraction pass (blood bending the terminal text behind it more strongly), a sub-bass hit under
  the first melted letter, and a second, shorter rewind glitch inside the Wavi act.

## Warnings kept on purpose

- `dead_stretch` (0-4.6, 8.1-22.4, 22.5-26.4, 31.1-36.6, 37.6-44.7 s): every scene is a canvas repainted every frame
  (logs scroll, blood moves, grain and jitter change), which the check cannot see; the one truly still stretch is the
  silent red frame 20.34-22.375, which is deliberate.
- `canvas_content_at_edge`: the camcorder picture is full-frame by design.
