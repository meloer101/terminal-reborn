# REVIEW — Wavi film E1, "One head, many arms"

Delivery render: `renders/e1-many-arms.mp4` (git-ignored), 49.6 s, 1920 x 1080, 30 fps, H.264 + AAC, 612 MB at
`--quality delivery` (the 6.5 % film grain is what makes it heavy; a share copy should be re-encoded).

## Creative calls

- One take: everything up to 44.8 s is one camera in one world (`compositions/abyss.html`, drawn by `assets/lib/abyss.js`).
  The only cut is a match on a line: the water's surface collapses to one bright horizontal line (44.25–44.8) and the
  site's tube warms up from a line (`compositions/tube.html`).
- The arm is a terminal rolled into flesh: each sucker is the bullet (⏺ / •) and the line of output is written across
  the arm beside it, in light, scrolling toward the tip every 0.4 s. The text lights the flesh (blurred spill).
- The heartbeat is the tempo: the track measures 75.00 BPM, a resting heart. Flesh swells 3.5 % and the lines flare
  20 % on each lub-dub; heartbeat and music both stop at 16.0, on the bar where the track's sub hit would land, and
  the eye tears open in that silence. Music returns at full on the ⌘J downbeat (22.4), from the track's own
  post-break section.
- The waiting arm's last line ("The Session table needs a migration first.") is written large along the arm while it
  freezes, because the eye framing lays the arm flat and the across-the-arm lines go vertical there.
- The head is an Old One silhouette (mantle, lobes, nine hanging face arms) with the Wavi orbit carved in as a dark
  red groove whose edge holds terminal light; it rises in the right third while the couplet and the ⌘Q line sit
  left-aligned in the water.
- Storylines not built here: E2 (REC 03:17) and E3 (Necronomicon folio) — other sessions.

## Review pass (snapshot --review + 18 QA frames from SPEC, then the same 18 frames pulled from the render)

Fixed in this pass:
- P0 · whole film · CLI snapshots/check timed out (minutes per frame) → scene timelines registered only after fonts
  loaded, so the runtime ran them as free siblings rendering in real time. Register synchronously, gate on
  `window.__hf.buildReady`. Seeks now 10–250 ms; check runs clean.
- P0 · t=7.7 · "MANY THREADS." crossed by the checkout-perf arm → moved to bottom-right.
- P0 · t=36.7–43 · couplet and ⌘Q line ran over the pale head → head pushed to the right third (camera x −900/−980),
  couplet 72 px, ⌘Q line 84 px, all left-aligned at x 150.
- P0 · t=15 · vite-7 swept in front of the waiting arm during the freeze → its root direction moved (phi 3.55 → 2.15).
- P1 · flesh read as ribbed grey hose (full-ring grooves, straight seam veins) → partial wavy folds, sinuous veins,
  warmer albedo with blotches, darker cavities coloured raw red, stronger key, back light and wet speculars.
- P1 · suckers read as chrome grommets / LEDs → softer rim profile, dimmer core.
- P1 · blood was a uniform red glow → wispy domain-warped clouds that read red only where lit; hook bloom enlarged so
  frame 0 shows it.
- P1 · head read as a lamp/egg with a neon logo → lobes, face arms, folds; sigil as carved groove, light only on its edge.
- P1 · stair-stepped / ribbed tubes seen end-on → disc stamps only where a segment is truly foreshortened.
- P1 · Bodoni hairlines vanished at 1080 → weight 500, `opsz` 20.
- P2 · processed SFX clipped (+1 to +9 dBFS) → rebuilt and peak-normalised to −1 dBFS; every hit placed so its peak
  lands one frame after its picture (heartbeat −0.137 s, eye −0.087 s, keys −0.037 s, coils on the retract).

## Measured vs looked at

- Measured: `check` (ok; warnings below), render length 49.600 s, loudness −16.3 LUFS integrated, true peak −1.5 dBTP,
  no clipping (renderer lowered the mix 4.1 dB); envelope shows the drop at 16.0 (≈ −20 dB bed only) and the slam at
  22.4 (−14.7). Music BPM/downbeats measured from the file (75.00 BPM, downbeats at 12.76 + 3.2k).
- Looked at: review sheets, phone sheet, seam strip, 18 QA frames from the renderer and 18 from the rendered file.
- Nobody heard it: the mix, the choir key against the track, and how the heartbeat sample sits were measured only.

## Warnings kept

- `dead_stretch` x4 (0–3.1, 12.6–16.4, 23.2–28.7, 31.9–35.1): the check reads DOM changes; the picture is a canvas
  that changes every frame in those spans (camera, writhing, scroll, prompt, merge, rise). Not real.
- `canvas_content_at_edge` (top, 2.8 s): full-bleed creature by design.

## Weakest shots / with more time

- The wide shots (6.4–13, 26–32): arms still read as smooth grey hoses with dash texture; I would add real
  self-shadowing, depth of field on the far arms and a stronger silhouette light.
- The head is still an egg at heart; a sculpted mantle (or a baked normal map) would sell the Old One.
- The rise 32–35 is mostly empty spine; a faster climb or the merged arms' knots on the spine would carry it.
- The end card shares D1's tube look (as the brief asks); its layout is distinct but the grammar is the same.
