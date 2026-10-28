# REVIEW — Wavi film E3, "Necronomicon, the Wavi folio"

## What was built

A 52 s film (1560 frames, 1920 x 1080, 30 fps) of one physical object: a book bound in black flesh on a stone table,
rendered in real 3D (Three.js r158) and lit by one raking candle. Every page is drawn procedurally into canvases
(albedo + height + roughness), so the engravings, type and blood have relief and the wet blood carries a real specular
streak; the leaves bend as they turn and cast shadows; the nails are 3D iron. The chain of objects:

cover (sewn eye tears open, magenta) → the cover slams open onto plate I (a trunk that splits into six tendrils and
rejoins: Branch out. Merge in.) → a drop of blood becomes a seal → the camera dives into the seal → the blood drains
off spread II (a chained casket, "~/.claude/settings.json" on its lid: Touch not the config of thy fathers. / HANDS OFF
YOUR CONFIG) → skin page turn → spread III (a great engraved eye: No account. No telemetry.) → dive into its pupil → out
of a real eye's pupil in the margin, "Do you want to proceed?" → ten eyes, ⌘J in blood, ten nails close them → page turn
→ spread V (a drowned city whose tendrils never stop: They run after ⌘Q. + Lovecraft's couplet) → last turn → the
Elder Sign (the Wavi orbit mark) pressed in blood inside the poster's ring → it ignites and burns through the vellum
onto the site's CRT, which shows the same mark → channel change → the sky WAVI and "Download for macOS" on the tube,
framed by the charred, smouldering hole.

Music: "Orc March" by basematic (ccMixter, CC BY 3.0) — orchestral march with choir and cello. Measured 60.01 BPM on the
onset grid, downbeats every 4 s from 0 in the file; the film enters at 140.0 s, so every scene seam sits on a bar
(0, 8, 16, 20, 24, 32, 40) and the file's own break (160-164 s) falls on the NO TELEMETRY spread, its loudest stretch
under the nails / couplet / burn, and its last chord rings out under the end card.

## Creative calls

- **One continuous object, not type on black.** D3 already did flat 1-bit Bodoni; E3's every frame is the book in
  light — relief, page curl, shadows, gloss — and the type lives on its pages.
- **Ink is bone-coloured on black vellum** (white-line engraving), so hatching density = light. Blackletter
  (UnifrakturMaguntia) is set in title case: blackletter caps are illegible. The rules' first letters are rubricated
  versals in blood; facts are Bodoni caps; the couplet and marginalia Bodoni italic. ⌘ is drawn as a path everywhere.
- **The ending is the burn itself.** Instead of cutting to a clean end card, the burn stops near the frame's edges and
  WAVI lands on the tube inside the charred hole, still smouldering: the brand appears out of the book, not after it.
  The end card scene was merged into the sign scene to make that possible (sign runs 40-52).
- **The tube shows the mark where the blood mark is**, at its projected size, so the first hole (in the mark's shape)
  opens onto the same mark on the television.
- "One person, many threads." is the last spread's colophon, opposite the sign.
- Storylines not built: E1 "One head, many arms" (the recommended one) and E2 "REC 03:17" — see STORYLINES.md in the
  D-series worktree; this session was assigned E3 only.

## What was measured, what was only looked at

- `npx hyperframes check --json`: ok (0 errors). Kept warnings:
  - 7 x `dead_stretch` — false positives: the check reads the DOM and cannot see the WebGL canvas, which changes on
    every frame (camera drift, candle flicker, blood, eyes). Verified on the snapshot sheets.
  - `console_warning` — Three.js r158's UMD build warns that it is deprecated; it is the last UMD line that ships
    `build/three.min.js` and works with the classic-script compositions.
  - 5 x info `canvas_content_at_edge` — the book fills the frame on purpose.
- `snapshot --review` (beats, 6 seam strips, phone sheet) and four targeted snapshot passes were read frame by frame.
- Music loudness measured with ffmpeg ebur128 on the placed slice: -14.3 LUFS at volume 0.5 → set to 0.4 (≈ -16 LUFS)
  so effects sit 3-6 dB over it. Every effect's peak time was measured and its clip placed so the peak lands one frame
  after its picture (nails 35 ms early, the whooshes so their swell peaks on the cut).
- **Nobody listened to the mix.** The sound was measured (onsets, peaks, loudness), not heard; the music was chosen from
  its tags, description and measured tempo, not by ear.

## Notes and fixes (first review pass)

P0
- t=40.1s · sign page · ember map left over from a later seek showed gold specks on the ring before the fire → the
  ember canvas is cleared and the emissive set to 0 whenever t < 44 (`Book.burning`) · every frame is again a pure
  function of t (parallel render workers seek out of order).
- lint · eyes.html, sign.html · `missing_three_script` (THREE used in a composition) → nails and the burnable page moved
  into `folio.js` (`addNails`, `placeNail`, `burnable`, `burning`) · compositions only call Folio.

P1
- t=5.2-5.6s · cover turn · the cover's own shadow left the frame ~1 s nearly black → the cover lifts 4.0-4.8 then falls
  and slams at 5.5 (in3); the candle dips only 25 % · the shadow sweep stays, it is now 0.3 s.
- t=5.0s · cover face to the candle blew out to beige → flesh roughness 0.41 → 0.59, env 0.9 → 0.55, darker base.
- t=0s · thumbnail · the shut eye read as a flat sticker / a mouth → soft socket, baked lid light from the candle side,
  a crease, longer lashes, old dried blood runs from four stitch holes · stitches and magenta reveal unchanged.
- t=16.3s · flood · flat bright red → deep #5e0202 film with uneven thick runs that catch the candle.
- t=17.5s · casket · the lid path was sheared and too small at the spread framing → casket enlarged, the path set
  upright in a cartouche at 56 px (≈ 45 px on screen) · whole spread stays in frame so rule and lid read together.
- t=34-38s · aeons · tendrils were hairlines and crossed the couplet → 13-22 px tubes routed to the margins and the
  page foot, clear of the rule, couplet and seal.
- t=28s · nails invisible at the spread framing → heads 0.0125 → 0.02 world units.
- t=49s · end card · the CRT's line tears ran through "Download for macOS" → a `calm` uniform in our tube.js copy turns
  tears, jitter and dropouts down from 48.8 s.
- audio lint · `duplicate_audio_track` on the stitch rips → each rip on its own track.

P2 (left)
- t=24.0s · the frame inside the margin eye's pupil is a magnified, soft texture for one frame (texture is 1280 px
  per page) — reads as motion at speed.
- t=43.5s · the darkened mark before ignition is low in contrast.
- t=32-40s · tendril hatching is ladder-like rather than fleshy.

## The delivery render

- `renders/e3-necronomicon_2026-10-24_10-52-29.mp4` (git-ignored): H.264 1920 x 1080, 30 fps, 52.000 s, AAC, delivery
  quality, 4 parallel workers (frames seeked out of order — the frames pulled from the first render matched the
  snapshots, so the seek-purity fix holds).
- Measured on the file: -14.8 LUFS integrated, true peak -1.3 dBFS, no clipping (the renderer trimmed 1.0 dB to stay
  under -1 dBTP). The first render came out at -18.1 LUFS because peaky effects (nails, bass hits) forced a 3.6 dB trim;
  those were turned down and the music raised 0.4 → 0.5 before this one.
- Onsets in the mix land on the picture: stitch rips 0.28-0.93 s, the cover slam 5.53 s, ⌘J 25.95 s, the ten nails at
  26.495 / 26.905 / 27.285 / 27.695 / 28.105 / 28.485 / 28.895 / 29.30 / 29.685 / 30.095 s (picture: 26.5 + 0.4 k),
  ignition 44.04 s, channel change 47.62 / 48.05 s.
- Strongest frames: 1.6 s (the eye torn open, magenta), 10.8 s (plate I, the tree of worktrees complete), 21.8 s (the
  engraved eye and "No account."), 27.4 s (ten eyes, ⌘J in blood, nails going in), 45.2 s (the mark burnt through
  onto the tube's mark); and 49.5 s, WAVI in the charred hole.

## Weakest shot, and with more time

- **The cover at frame 0.** It reads as a sewn-shut eye in a flesh book, but it is dim and the relief is mostly baked;
  with more time I would model the lids as displaced geometry (a real bulge for the light to rake) and add a sliver of
  magenta showing between two stitches so the thumbnail already promises the eye.
- Push further: a 2048 px texture set for the close-ups (24.0 s dive, 24.3 s margin eye), real smoke from the burning
  mark, a second, colder light from the television once the hole opens (it should light the charred edges blue), and
  a pass on the end card so the sky inside WAVI is more saturated through the tube.

## Shortcuts

- The SPEED convention: each scene's GSAP timeline is 1.5x its film length and played with `timeScale(1.5)` as in A-C,
  but the choreography is written directly in film seconds (the canvas renderers convert authored → film time), not
  designed at 1x and then sped up.
- Three.js is loaded from jsDelivr like GSAP (not vendored).
- The end-card scene was folded into the sign scene (one scene 40-52) rather than kept separate.
- No quill scratch under the engraving (the CC0 recording was mostly noise floor); the music carries those beats.
