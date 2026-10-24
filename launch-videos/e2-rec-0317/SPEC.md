# SPEC — Wavi film E2, "REC 03:17"

```text
GOAL:    in 51 s a stranger watches a recovered recording of someone's night: eight agents stream, one has waited 23
         minutes on "Do you want to proceed?", the logs turn to R'lyehian chant and the waiting pane bleeds until the
         screen drowns red. The tape rewinds; the same night in Wavi: the eight fold into the sidebar, only that row is
         magenta, ⌘J, answer, the blood runs back into the text, ALL RUNNING. They leave with WAVI and "Download for macOS".
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, English on screen, no voice.
TIME:    50.852 s x 30 = 1526 frames. One clock for the whole film: "Nightmares" (donniedrost) at 117.99 BPM,
         beat 0.50852 s, bar B = 2.03407 s. Film bar k starts at k x B:
         0 2.034 4.068 6.102 8.136 10.170 12.204 14.238 16.273 18.307 20.341 22.375 | 24.409 26.443 28.477 30.511
         32.545 34.579 36.613 38.647 40.681 42.716 44.750 46.784 48.818 50.852.
         The track's own bar (file 8.1395, where the full band slams in after a filter-sweep drop) lands on film 26.443,
         so its downbeats are the film's bar lines; acts 1-2 run on the same grid without the drums. Every seam is on a bar.
         Scenes are authored at 1x and played at SPEED 1.5: inside a scene one bar is 3.0511 s, one beat 0.76278 s.
LOOK:    a recording played back off tape: the real Wavi dark UI rebuilt at 2x, painted to a canvas every frame, then one
         WebGL pass (assets/lib/rec.js) that is the camcorder:
         - green grade: luma mapped to #051109 (black) -> #4a8c52 (mid) -> #e0ffd9 (white), 88 % in act 1, 62 % in
           the Wavi act (magenta #ff5fb0 and running blue #5ea1ff are passed through), 0 % on the end card;
         - tape: luma grain 7 %, interlace every 2 px at 5 %, chroma offset 2 px (red right), auto-gain breathing +-2 %,
           vignette 30 %, head-switching band in the bottom 14 px, line jitter 0.6 px; rewind adds 3 tear bands,
           18-40 px skew, 30 % noise bars;
         - autofocus hunt after every zoom: 0 -> 5 px blur -> 0 over 0.35 s.
         Blood is the only red in the film: a fluid layer over the UI from a seeded, time-driven field
         (assets/lib/blood.js: drips with surface tension, stick-slip runs, trails, pools with a meniscus at each pane
         wall, impact ripples, glyphs that melt). The shader thresholds the field at 0.5, takes normals from its
         gradient, and shades #e00f17 (thin) -> #85030a (thick), dark clots #290205 (70 %) from fbm in thick parts, broad
         slow swells in the normals of deep blood, a key light from top-left with specular pow 48, thin blood refracting
         the UI 6 px.
         Type: JetBrains Mono (terminal 14.5 px in a 480 x 540 pane = 30-38 px on screen when the camera is in);
         Wavi UI in Archivo 400-600 (row title 26 px, sub 24 px, mono meta 24 px, a-waiting's 2x rebuild);
         display Archivo 900 width 112 % (ALL RUNNING 150 px, AGENTS RUN AFTER ⌘Q 118 px);
         the couplet Bodoni Moda 400 italic-free, 64 px.
         OSD (camcorder, never graded): white JetBrains Mono 700 34 px with a 3 px black outline:
         "● REC" top-left (the dot blinks 1 s; white, not red), battery top-right, date "OCT 24 2026" and the clock
         "03:17:06 AM" bottom-left/right; playback device overlay "◀◀ REW" / "▶ PLAY" replaces REC in the rewind.
OBJECTS: eight terminals tiled 4 x 2 (480 x 540 each) like eight macOS windows, unfocused grey traffic lights,
         title "<worktree> — claude|codex": Claude Code "⏺ Tool(arg) / ⎿ result / ✻ Verb… (time · esc to interrupt)"
         with its rule-boxed ">" input, Codex "• Ran cmd / └ out / • Working (time • esc to interrupt)" with "›" input;
         session-cookie (bottom row, 2nd) frozen on Claude's permission prompt (a-waiting's replica) with a block cursor
         after "Do you want to proceed?"; the chant "Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn" woven into
         paths, results and spinner verbs ("✻ Fhtagn… (23m · esc to interrupt)"); the 23:00 readout
         ("NO INPUT SINCE 02:54" / "23:00"); Wavi's sidebar (two projects, eight rows, StatusGlyph needs-you / running),
         the main terminal, keycaps ⌘ J "Jump to it", 1 "Yes", ⌘ Q "Quit"; the sky-filled WAVI; "Download for macOS".
MOTION:  camera = the camcorder zoom: 0.75 beat (0.57 s film) power3.inOut, then an autofocus hunt; a 2-3 px handheld
         drift (two incommensurate sines). Text is printed line by line (scroll), never faded. Blood moves by its own
         physics; flowing back is the same function run backwards. Fold = each pane's rect morphs into its sidebar row
         over 0.6 s power3.inOut, contents fading in the first 0.15 s. Keycaps: press 0.1 s, fill white.
SHOTS (film time; bar numbers in brackets):
  1 night   0.000-22.375 [0-11]
    0.00  REC over the wall of eight; pane 6 (session-cookie) frozen on the prompt, one drop already rolling down from
          the cursor (frame 0 = thumbnail). The other seven stream. Fan hum; a drip on every cursor blink (1.017 s).
    4.07  [2] zoom into session-cookie, 2.0x; "NO INPUT SINCE 02:54" + "23:00" (180 px) at 5.0-7.9; cursor blinks, drops.
    8.14  [4] pull back to the wall: the logs start turning into chant (one word, then whole lines, then caps), low chant
          rises under them; 10.17 [5] punch 2.4x into docs-search (Codex) to read "• Ran ph'nglui --mglw'nafh".
   12.20  [6] back into session-cookie 2.6x: the letters of "Do you want to proceed?" turn red one by one and melt; drips
          run down over the options, the pool forms at the pane floor with a meniscus; the camera tilts down after them.
   16.27  [8] pull back: every pane bleeds, pools rise pane after pane (session-cookie first), the wall drowns; 19.6 all red.
   20.34  [10] total silence: a still red frame, only the REC dot blinking.
  2 rewind  22.375-26.443 [11-13]  "◀◀ REW", tape screech: the night plays backwards (blood drains up into the text,
          chant unscrambles, zooms run in reverse, the clock runs back 03:17:26 -> 03:17:09); 25.9 "▶ PLAY" on the clean wall.
  3 wavi    26.443-36.613 [13-18]  the music slams in: the eight panes fold into Wavi's sidebar; only "Session cookie
          migration" is magenta ("waiting 23m"), and red drips start from its line; 27.5 HUD ⌘ J; 28.48 [14] ⌘J: the
          main area morphs to that session, prompt bleeding; 30.51 [15] "1": the blood runs back up into the text, the
          letters turn white, the agent continues; the row turns running; 32.55 [16] pull back, "ALL RUNNING." lands;
          34.58 [17] "One person, many threads." under it.
  4 coda    36.613-44.750 [18-22]  ⌘ Q: the window quits; on the dark tape eight running spinners keep turning;
          37.6 "That is not dead which can eternal lie," / 38.6 "And with strange aeons even death may die."
          42.72 [21] "AGENTS RUN AFTER ⌘Q".
  5 end     44.750-50.852 [22-25]  the camcorder stops (picture to a line); the clean, ungraded end card: the sky WAVI
          fills from the bottom with a liquid surface (the drown, redeemed), 46.78 [23] "Download for macOS"; hold;
          music fades over the last 1.5 s.
SOUND:   fan hum 0-20.34 (stops dead); Songs in Fallen Halls (PorchCat) as the low drone 0-20.34, rising at the chant;
         a monk chant pitched down 3 semitones under the logs 8.14-20.34; 20 drips on the cursor blinks (5 takes);
         total silence 20.34-22.375; tape-rewind screech 22.375-25.9 (a VHS rewind + the night's drone reversed at 5x);
         a deck clunk on PLAY; Nightmares from 26.443; keys on ⌘J, 1, ⌘Q; a reversed drip as the blood runs back;
         bass impacts on ALL RUNNING and AGENTS RUN AFTER ⌘Q; lens close on the stop.
BANNED:  a black void with small things floating (the hero fills >= 60 % of the frame height in every shot);
         glow, bloom, flares, particles as decoration; purple/blue gradients, glass cards; red anywhere but the blood
         (UI error red, a red REC dot, red UI states are all out; the sky WAVI's own fringe on the clean end card is the
         brand file and stays); D2's grammar: channel surfing, VHS OSD green, fast-forward counter, macroblocks;
         D1's barrel-curved tube; realistic human injury, bodies, faces; blood as flat red shapes without light;
         text that moves while it is read; titles that drift after landing; invented product UI, numbers or claims
         (only the facts in the brief; 23:00 and branch names are illustrative); the logo docked in a corner;
         crossfades between scenes (cuts on bars, the fold, the rewind, the stop).
QA:      f0 (REC, wall of eight, one drop under the cursor) · f150 (2x prompt + 23:00 readable) ·
         f300 (chant in the logs) · f330 (Codex chant line readable) · f420 (red letters melting, drips, pool) ·
         f540 (panes drowning) · f630 (all red, silent) · f700 (rewind tears) · f790 (PLAY, clean wall) ·
         f805 (fold mid-way) · f840 (magenta row, ⌘J HUD) · f880 (prompt in main, bleeding) · f935 (blood flowing back) ·
         f1010 (ALL RUNNING.) · f1150 (couplet + spinners) · f1300 (AGENTS RUN AFTER ⌘Q) · f1400 (WAVI filling) ·
         f1520 (WAVI + Download for macOS).
```

## Notes

- Copy is the brief's: "Do you want to proceed?", ⌘J jumps to the agent waiting on you, "One person, many threads.",
  "AGENTS RUN AFTER ⌘Q" (from the poster line), the Lovecraft couplet (The Nameless City, 1921, public domain),
  "Download for macOS". Terminal lines follow a-waiting's rebuild of real Claude Code / Codex output.
- Everything visible is a pure function of timeline time: each scene drives one clock through a GSAP setter and repaints
  its canvases from it; the blood field has no state (every drip's position is a closed-form function of its age).
