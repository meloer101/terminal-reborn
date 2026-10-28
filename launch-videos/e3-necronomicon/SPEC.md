# SPEC — Wavi film E3, "Necronomicon, the Wavi folio"

```text
GOAL:    in 52 s a stranger watches a cursed book open itself and read out the rules Wavi really keeps, each one sealed
         in blood: branch out / merge in, hands off your config, no account / no telemetry, the ten that wait on you
         nailed shut with J, they run after ⌘Q. The last page is the Wavi mark pressed in blood; it burns through the
         vellum into the site's television, where WAVI and "Download for macOS" land. They should want to own the book.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, English on screen, no voice.
TIME:    52.000 s x 30 = 1560 frames. Music "Orc March" by basematic (ccMixter, CC BY 3.0): measured 60.01 BPM on the
         full-band onset grid (strength 0.21), beats on whole seconds of the file, downbeats on multiples of 4 s
         (beat%4 = 0 strongest, beat%8 = 0 strongest). Beat 1.000 s, 8th 0.500 s, bar 4.000 s. The film enters the
         file at 140.000 s, so film bar lines are B(k) = 4k: 0 · 4 · 8 · 12 · 16 · 20 · 24 · 28 · 32 · 36 · 40 · 44 ·
         48 · 52. Every scene seam is on one. The file's break (160-164 s: rms -16 dB, stabs on beats 2 and 4) is film
         20-24 = the NO TELEMETRY spread; its loudest stretch (168-188 s, -7 to -5.6 dB) is film 28-48 = the nails, the
         couplet, the Elder Sign and the burn; its last chord rings out from 188 s = film 48 under the end card.
         SPEED 1.5: every scene is authored at 1x (one beat = 1.5 authored s) and played at 1.5, as films A-C.
LOOK:    One medium: a real bound book on a stone table, rendered in 3D (Three.js r158, seekable: every frame is
         rendered from timeline time only), lit by ONE raking candle light.
         - Light: a warm spot (#ffb070) from the upper left at 14-20 deg above the page plane, 2048 px PCF soft shadow
           map; intensity flickers 0.86-1.0 from a hash of film time at 12 Hz (deterministic); a fill (#3a2a24) at
           6 %; no environment light. The page curl, the cover, the nails and the page stacks all cast real shadows.
         - Vellum: black-brown #17110d → #251a13 mottling (3-octave value noise), fibre streaks 3 %, a 6 % darker
           edge falloff, bump amplitude 0.6, roughness 0.82. Page edges: a striped deckle block, 18 leaves visible.
         - Flesh (cover and boards): #3a1d18 → #5a2c24 mottled, wrinkles as dark sinuous lines + bump, pores in bump,
           patches sewn together with thick black stitches (the binding), roughness 0.45 (it sweats).
         - Ink: engravings and type are bone ink #d6c8aa on the black vellum, raised 0.25 in bump, roughness 0.55.
           Engraving = line art only: contours + parallel hatching + cross-hatching for shadow, hatch pitch 7-9 px of
           page texture; no fills except the pupil black.
         - Blood: #7a0000 (pooled, deep) → #d10f0f (thin, lit), raised 0.9 with a soft 6 px shoulder, roughness 0.10
           so the raking light lays a specular streak on it; it only appears as drops, beads, runs, seals and stamps.
         - Magenta #ff5fb0 only in irises (the cover eye, the ten margin eyes). It means "waiting on you".
         - Type: UnifrakturMaguntia (OFL, self-hosted subset) for every rule, title case (blackletter caps are
           illegible), 120-150 px of page texture = 70-110 px on screen; first letter of each rule a rubricated
           versal in blood. Bodoni Moda (OFL) roman caps 30-36 px on screen, tracking +12 %, for facts; Bodoni Moda
           italic 40-46 px on screen for the couplet and the marginalia. ⌘ is drawn as a path (no font has it).
         - Grain 4 % (stepped every frame), and the frame's darkness is the light falloff of the candle, not a
           vignette. The final tube is the site's CRT (assets/lib/tube.js from film D1).
OBJECTS: the flesh cover with a sewn-shut eye (7 cross-stitches across the lid seam, black thread), magenta iris;
         the book (two page blocks, flesh boards, spine gutter shadow); the turning leaf (bends, casts a shadow);
         plate I: a tree of worktrees — one trunk ("main") splits into six tendrils that bow out and rejoin the trunk
         above (a git graph drawn as flesh), in an engraved oval plate; plate II: a chained reliquary casket, padlock,
         "~/.claude/settings.json" engraved on its lid; plate III: one huge engraved eye with a black pupil;
         spread IV: ten real eyes in the two outer margins, each with "Do you want to proceed?" in marginalia, ten
         forged iron nails (3D, square shank, hammered head); plate V: a drowned city of leaning towers whose ink
         tendrils keep crawling out of the plate; the Elder Sign: the Wavi orbit mark (site orbit.svg) as a blood
         stamp inside an inscribed ring; the burn front (char + a 3 px ember line #ff7a1a, no bloom); the tube with
         the sky WAVI (Figma asset) and the "Download for macOS" button.
MOTION:  Camera: power2.inOut for moves (0.8-1.2 s), power3.in for dives (1.0 s), arrive on expo.out; max one camera
         move per beat pair; at rest the camera holds dead still except a 0.15 deg handheld drift (sum of 2 sines).
         Page turns 0.8 s (power2.inOut on the angle, the outer edge lags by 0.6 rad at mid-turn). Type is never typed
         or slid: each line "takes the ink" in 0.13 s (opacity 0 → 1, blur 6 → 0 px) on its beat. Blood: drops fall
         in 0.12 s (power2.in), spread in 0.5 s (expo.out), beads swell in 0.4 s (back.out(1.4) on radius only).
         Nails: fall 0.10 s (power4.in), stop dead (0 ms set), the camera jolts 4 px for 2 frames.
SHOTS (film time; bar lines in [ ]):
  1 cover    0-8      f0: the flesh cover fills the frame top-down, the eye sewn shut, raking light (thumbnail).
             [0]      0.25-0.85 the seven stitches snap one by one (5-6 frames apart), blood beads at each hole;
                      1.00 the lids tear open, magenta iris, the pupil contracts 1.00-1.40; 1.6-3.6 it looks left,
                      right, then at the camera (saccades 3 frames each). [4] 4.0-4.8 the cover lifts itself off
                      the book, 4.8-5.5 it falls over to the left and slams onto the table (rigid, hinge at the
                      spine); the camera rises and tilts to the spread. 5.8-8.0 plate I engraves its trunk.
                      sfx: rip per stitch (3 takes), wet open at 1.0, leather creak + thud on the cover turn.
  2 branch   8-16     [8] framed on plate I (plate 92 % of frame height); 8.0-11.0 the tree engraves itself, root
                      to crown: the trunk, 9.0 it splits into six (branch out), 10.0-11.0 they bow back and rejoin
                      (merge in). 11.0-12.0 camera pans to the right page. [12] "Branch out." takes the ink; 13.0
                      "Merge in."; 13.5 Bodoni caps "EACH AGENT RUNS ON ITS OWN GIT WORKTREE". 14.0 a drop of blood
                      falls onto the foot of the page and spreads into a seal, 14.6 a signet sigil (fork and join)
                      presses into it. 15.0-16.0 the camera dives into the seal; its red fills the frame.
                      sfx: the engraving draws under the music; drop + wet stamp on the seal, whoosh into it.
  3 config   16-20    [16] the frame is all blood; it drains down off the page in streaks (16.0-16.85) as the camera
                      pulls back to the whole spread: plate II (casket, chains, padlock, "~/.claude/settings.json"
                      set upright in a cartouche on the lid) and the rule. 16.8 "Touch not / the config" / 17.3 "of thy
                      fathers."; 18.0 "HANDS OFF YOUR CONFIG"; 18.5 a blood seal with a padlock sigil. 19.2-20.0 the
                      right leaf turns over (skin page turn).
                      sfx: gush, drip + wet press, page turn.
  4 account  20-24    [20] music drops to the break. Plate III, the great engraved eye; rule page right.
                      21.0 (stab) "No account."; 22.0 "No telemetry."; 22.5 a blood seal (closed-eye sigil).
                      23.0 (stab) the camera dives into the engraved eye's black pupil (1.0 s, power3.in).
                      sfx: drip + press; a low whoosh into the pupil.
  5 eyes     24-32    [24] out of the black: a real eye in the margin, its pupil filling the frame, the camera pulls
                      back (expo) to it with "Do you want to proceed?" under it, held 24.6-25.3. 25.3-26.2 pull back
                      to the spread: ten eyes down the two outer margins, all magenta; centre left "Do you want / to
                      proceed?" (blackletter); 26.0 a blood ⌘J lands centre right over "JUMPS TO THE AGENT WAITING ON
                      YOU" and every eye snaps to look at us. 26.5 + 0.4 k (k = 0..9) an iron nail falls into eye k
                      (left column top→bottom, then right), the lid slams shut, blood beads and runs. 30.1-31.2 all
                      ten shut; hold. 31.2-32.0 the leaf turns, the right column's nails riding it, driven through.
                      sfx: impact + wet hit on ⌘J, one nail strike per nail (3 takes rotated), page turn.
  6 aeons    32-40    [32] plate V: the drowned city, its ink tendrils crawl out of the plate over both pages and
                      never stop (the agents keep running), routed clear of the type. 33.0 "They run / after ⌘Q."
                      34.5 couplet line 1, 36.5 line 2 (Bodoni italic) + "H. P. LOVECRAFT · THE NAMELESS CITY ·
                      1921"; 38.0 blood seal (⌘ sigil). 39.2-40.0 the last leaf turns.
                      sfx: drip + press, page turn.
  7 sign     40-52    [40] the last spread: "One person, / many threads." (Bodoni italic) left; right an inscribed
                      ring "NO ACCOUNT · NO TELEMETRY · HANDS OFF YOUR CONFIG · AGENTS RUN AFTER ⌘Q ·" round an empty
                      centre. 40.5 the Elder Sign is pressed: the Wavi mark fills with wet blood in 0.3 s. 41-44 the
                      camera pushes in; the blood darkens and its edges scorch. [44] it ignites: the mark burns
                      through first (44.0-44.45, the hole in the mark's shape shows the tube's own line-screen mark
                      behind, at the same place and size), then the front runs out (44.45-47.6, power2.inOut) and
                      stops near the frame's left and right edges, leaving a charred, smouldering border.
                      [48] channel change on the tube: the sky WAVI (50 % width, rising) and "Download for macOS"
                      (48.75) inside the burnt hole; 48.8-49.1 the tube calms (tears and dropouts off) so the
                      button reads; held to 52; the track's last chord rings out (fade 1.2 s).
                      sfx: wet stamp + low hit at 40.5, ignition + hit at 44, low fire bed 43.6-52, static and a
                      glitch on the channel change.
BANNED:  the CRT's line tears and dropouts across small type (calmed on the end card); a frame left black by the
         cover's own shadow for more than 0.3 s; seek-dependent state (every canvas, map and mesh is set from t);
         a dark void with small things floating in it (the book or a page always fills >= 90 % of the frame);
         glow, bloom, lens flares, floating particles, smoke as decoration (smoke only rises from the burning mark);
         gradients except the light's own falloff; magenta anywhere but an iris; red anything but blood;
         stock images, scanned books, copyrighted art; realistic human injury (no hands, no wounds — the eyes are the
         book's, nails go through lids drawn in the engraving's material); type that slides, types on, drifts or
         scales after it lands; blackletter in all caps; D3's ring of ten "?", 1-bit look or flat type on black;
         crossfades between worlds; corner labels, frame borders, HUD; the logo docked in a corner; three cards.
QA:      f0 (flesh cover, sewn eye, never empty) · f30 (eye open, magenta) · f150 (cover mid-turn, shadow on the
         spread) · f300 (tree splitting) · f375 (Branch out. legible) · f435 (seal, wet specular) · f465 (red flood) ·
         f525 (config rule + lid path legible) · f590 (page curl mid-turn) · f660 (NO ACCOUNT / NO TELEMETRY) ·
         f710 (diving into the pupil) · f725 (margin eye + marginalia legible) · f790 (ten eyes, ⌘J) · f850 (half the
         nails in) · f920 (all shut) · f1050 (couplet line 1) · f1120 (couplet both lines) · f1230 (Elder Sign in
         blood, ring legible) · f1350 (burn front, tube visible through it) · f1470 (WAVI + Download for macOS in the
         burnt hole) · f1559 (end hold).
```

## Notes

- Copy on screen is the product's own: "Branch out. Merge in." (site), "each agent runs on its own git worktree",
  "~/.claude/settings.json" (never written by Wavi) with "HANDS OFF YOUR CONFIG", "NO ACCOUNT · NO TELEMETRY",
  "Do you want to proceed?" (Claude Code's permission prompt), ⌘J (jumps to the agent waiting on you), the poster line
  "NO ACCOUNT · NO TELEMETRY · HANDS OFF YOUR CONFIG · AGENTS RUN AFTER ⌘Q", WAVI and "Download for macOS". The rules
  are restated as commandments ("Touch not the config of thy fathers.", "They run after ⌘Q.") — mood, not new claims.
- The couplet is Lovecraft's, "The Nameless City" (1921), public domain.
- Music and sound credits: `assets/sfx/CREDITS.md`.
