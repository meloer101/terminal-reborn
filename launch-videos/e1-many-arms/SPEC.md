# SPEC — Wavi film E1, "One head, many arms"

```text
GOAL:    in 50 s a stranger sees "One person, many threads." as a thing in the deep: one pale spine (main), eight arms
         (one per worktree) writing terminal output; the one that waits opens an eye and bleeds; ⌘J goes into it and
         answers; every arm merges back into main and the head rises. They leave with WAVI and the feeling that the
         agents never die (AGENTS RUN AFTER ⌘Q).
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, English on screen, no voice.
TIME:    49.6 s x 30 = 1488 frames, ONE continuous take (no cuts) until the surface becomes the tube's warm-up line at
         44.8. Music 75.00 BPM (measured): beat 0.800 s = 24 frames, bar 3.200 s = 96 frames. Film bar lines
         B(k) = 3.2k: 0 3.2 6.4 9.6 12.8 16.0 19.2 22.4 25.6 28.8 32.0 35.2 38.4 41.6 44.8 48.0 (end 49.6 = half bar).
         Every beat of the film starts on one of them. The heartbeat is the tempo (75 bpm = a resting heart).
         Scenes are authored at 1x and played at SPEED 1.5 (authored seconds = film seconds x 1.5).
LOOK:    a real horror-film frame shot in black water, not vector art.
         Water: abyssal black-green #020604 at depth, #0b1a14 near the surface; depth haze to #04100b with
         extinction 0.0009 per world unit; light shafts from above (3 shafts, 6-14 % over the water, gone below
         depth 0.5); marine snow: 2 layers of specks, 1-3 px, max 18 % alpha, drifting up at the camera's sink speed
         (it is how the descent reads; never decoration). Grain 5 %, vignette 38 %, refraction wobble 1.5 px.
         Flesh: #d8d2c4 albedo, lit per pixel from a normal buffer (canvas → WebGL): key light from above
         (cold #cfe3d8, falls to 15 % at depth), wrap-diffuse 0.35, subsurface rim #b06a58 at grazing angles, wet
         specular Blinn exponent 90 x 0.9 + sheen exponent 14 x 0.18, broken by noise into streaks; caustics
         (animated cell pattern) only on up-facing flesh near the surface; cavity (wrinkle rings every 0.55 r,
         two veins per arm, sucker cups) darkens to 18 %.
         Terminal light: the suckers are the bullets (⏺ Claude, • Codex) and each line of output is written in light
         ACROSS the arm beside its sucker, #d9efe6, so the arm reads as a terminal rolled into flesh; the text lights the
         flesh around it (blurred spill, 0.55). Lines scroll toward the tip every 0.4 s.
         Blood #8a0000 → #ff1a1a only around the arm that waits (and the one bloom in the hook from the same arm):
         domain-warped fbm clouds, absorbing, lit red only where terminal light reaches them.
         Magenta #ff5fb0 only in the iris. Display: Wavi Bodoni (Bodoni Moda) 400 caps, 96-132 px, tracking +4 %,
         bone #e9e4d8 on the water, never moving once landed. Prompt and counter: Wavi Mono (JetBrains Mono) 500.
         End card on the site's tube (assets/lib/tube.js, copied from D1).
OBJECTS: the spine (main): a vertical tube r = 96, its flesh carrying "main" and the merge lines;
         eight arms (one per worktree, labelled at the root in mono: checkout-perf, sidebar-agg, webhook-retry,
         graph-layout, mobile-nav, session-cookie, docs-search, vite-7), r = 74 at the root tapering to 5, length
         1500-2100, writhing with curvature waves travelling root → tip; suckers in rows, each a lit cup;
         the eye: almond lids of the same flesh, wet sclera with red veins, magenta iris with radial fibres, black
         pupil, one catchlight; "Do you want to proceed?" inked in the white (left/right of the iris);
         the prompt inside the pupil: the real Claude Code permission prompt (Bash command / pnpm prisma migrate dev /
         Do you want to proceed? / ❯ 1. Yes / 2… / 3…) and its answer lines;
         the counter 00:00 → 23:00 in blood red mono beside the eye (illustrative);
         the head: a pale mantle r = 540 (egg, 0.95 x 1.3) with folds from the crown and creases at the base, two
         lobes behind it, nine face arms hanging under it; the Wavi orbit mark (site orbit.svg) carved in it as a dark
         red groove whose edge fills with terminal light; the surface from below: a bright rippling band that becomes the tube line;
         the tube: the sky-filled WAVI (Figma asset) and "Download for macOS".
MOTION:  camera: one path, eased power2.inOut between keys, never still (min drift 6 px/s); the dive into the eye is
         power3.in 0.8 s, the pull out expo.out 0.6 s. Arms sprout over 1.6 s (expo.out on length, a 2-wobble overshoot
         on curvature); coil back into main over 0.8 s (power3.in on length, curvature x 3). Titles land as one
         frame cut on a beat (no fade, no slide) and leave as a cut; held dead still between.
SHOTS:   (film seconds; one take, so these are beats of one shot)
                       (Heartbeat: the flesh swells 3.5 % and the terminal light flares 20 % on every lub-dub until 16.0.)
  1 hook     0.0-3.2   macro on the session-cookie arm filling the frame diagonally, r ≈ 360 px: suckers lit, its real
                       output written across the arm; red ink blooms from one sucker (frame 0 already blooming).
                       Camera pulls back and sinks. sound: deep-sea bed, sub drone, heartbeat on every beat, a bloom.
  2 descent  3.2-6.4   the pull-back reveals the arm hangs from a pale spine sinking into black: "ONE PERSON," (3.2-6.2).
  3 branch   6.4-12.8  arms sprout from the spine on beats: 2 at 6.4, 7.2, 8.0, 8.8; 9.6 (music's first sub hit),
                       10.4, 11.2 → eight; "MANY THREADS." (6.4-9.4), "BRANCH OUT." (9.6-12.6); each root carries
                       its worktree name. sound: a wet creak per arm (three takes rotating).
  4 writhe   12.8-16.0 all eight writhing and streaming; the camera glides toward session-cookie; at 14.4 it stops
                       writhing, its lines stop, and its last line "The Session table needs a migration first." is
                       written large along the arm (the arm lies flat in this framing, so lines across it are vertical).
  5 eye      16.0-19.2 on the downbeat the music and the heartbeat stop dead; an eye tears open on the frozen arm:
                       magenta iris, "Do you want to proceed?" in its white; counter starts. sound: wet tear.
  6 blood    19.2-22.4 blood clouds out of the eye's lids into the water, the counter races to 23:00 and holds;
                       the other seven keep writhing behind. sound: bed and drone only, a low bloom.
  7 ⌘J       22.4-25.6 "⌘J" on the downbeat; the music returns at full (file 67.148); the camera dives into the pupil
                       (0.8 s); inside: the prompt, "❯ 1. Yes" taken at 24.0, the answer lines print; 25.0 pull out;
                       25.6 the eye shuts and the arm writhes again. sound: key, dive, wet shut.
  8 running  25.6-28.8 the blood thins; all eight arms stream, the camera pulls back to see them all.
  9 merge    28.8-32.0 "MERGE IN." + "⇧⌘M": the arms coil back into main one per 0.4 s; each merge writes
                       "Merge branch '<name>'" on the spine. sound: a wet coil per arm (two takes).
 10 rise     32.0-35.2 the thing rises: the camera climbs the spine to the head; the orbit sigil carved in it fills
                       with light. sound: choir swell enters.
 11 couplet  35.2-41.6  (head in the right third, type left-aligned at x 150 in Bodoni 72 px) "THAT IS NOT DEAD WHICH CAN ETERNAL LIE," (35.2-38.3) / "AND WITH STRANGE AEONS EVEN DEATH
                       MAY DIE." (38.4-41.5) while the head rises toward the light.
 12 ⌘Q       41.6-44.8 "AGENTS RUN AFTER ⌘Q" over "NO ACCOUNT · NO TELEMETRY · HANDS OFF YOUR CONFIG"; the surface
                       light floods down until it is one bright line (44.6).
 13 end      44.8-49.6 the line is the tube warming up: the sky WAVI, "Download for macOS"; hold 3 s; music fades 1.2 s.
BANNED:  vector clip-art flesh (flat fills, outlines, cartoon suckers); realistic human injury; red anywhere except
         around the waiting arm; magenta outside the iris; a cut before 44.8; a black void with a small creature in
         it (the creature fills >= 60 % of the frame in every beat but the rise's reveal); glow/bloom/lens flares
         (light only comes from the surface and the terminal lines); purple/blue gradients; glass cards; titles that
         fade, slide or drift; corner labels, frame borders, HUD readouts; the logo docked in a corner;
         D3's altar / ten "?" ring and D1's channel-change grammar; invented UI or numbers presented as measured;
         (found in review) full-ring grooves that make flesh read as ribbed hose; chrome-bright suckers; a
         stair-stepped tube seen end-on; a uniform red glow standing in for blood; the sigil as a white neon outline;
         a bare egg for a head; titles over the creature's pale flesh.
QA:      f0 (macro arm, lit lines readable, red bloom: never black) · f60 (pull-back, lines legible) ·
         f130 (spine + ONE PERSON,) · f230 (four arms + MANY THREADS.) · f330 (eight + BRANCH OUT., root labels
         legible) · f450 (frozen arm, stuck line) · f520 (eye open, Do you want to proceed? legible) ·
         f630 (blood + 23:00) · f690 (⌘J, dive) · f725 (prompt inside the pupil readable) · f745 (1. Yes answered) ·
         f800 (eye shut, arm moving) · f900 (merging + MERGE IN.) · f1010 (head + sigil) · f1100 (couplet 1) ·
         f1200 (couplet 2) · f1290 (AGENTS RUN AFTER ⌘Q) · f1440 (WAVI + Download for macOS legible).
```

## Notes

- Copy on screen is verbatim from the brief's product facts: "One person, many threads." (split as the title
  device), "Branch out. Merge in.", "Do you want to proceed?", ⌘J, ⇧⌘M, the poster line, "Download for macOS",
  and Lovecraft's couplet (The Nameless City, 1921, public domain). Terminal output is the rebuilt Claude Code /
  Codex copy from film A (`launch-videos/a-waiting`); worktree names are illustrative, as is 23:00.
- Music: "Outer Planet" by Robbero (ccMixter, CC BY 3.0), measured 75.00 BPM, downbeats at file 12.76 + 3.2k.
  Part 1 enters at file 3.16 (film 0 on a downbeat; its first sub hit lands at film 9.6) and stops at film 16.0,
  one frame before the hit, where the eye opens. Part 2 enters at file 67.148 (the full section after the track's
  own break) on the ⌘J downbeat, film 22.4.
- Everything visible is a pure function of timeline time: `assets/lib/abyss.js` draws the creature into two
  canvases (normal buffer, material buffer) plus an eye layer, and one WebGL pass lights them.
