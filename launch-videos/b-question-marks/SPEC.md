# SPEC — Wavi teaser B, "Ten question marks"

```text
GOAL:    in 24 s a stranger gets "ten agents are waiting on me; Wavi answers them one by one" and remembers the tube.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, English on screen, no voice.
TIME:    24.5 s x 30 = 735 frames. Grid 120 BPM = 15 frames a beat; scene seams on beats (4.5, 8.5, 12.5, 16.5,
         19.5 s), the type cuts on beats (16.5, 18.0), the nine fast answers on 16ths (0.125 s).
LOOK:    ground #050505 with stepped grain 5 % (fractal noise, 240 px tile, steps of 1 frame) on the type worlds
         (tube, type, end); product ground #0a0a0a under the UI worlds (row, graph).
         Ink #ededed, secondary #a1a1a1. One accent #ff5fb0: only the waiting "?" and the needs-you glyph.
         Status colours only as the app uses them: running #5ea1ff, done #3dd68c.
         Display: Wavi Archivo (site subset) 900, width 112-125 %, -2 % tracking; "?" 230 px; lines 104 px.
         Payoff: Wavi Bodoni (site subset) 400 caps, 250 px. UI: Inter / JetBrains Mono, the app at 2.4x.
         The one material: the CRT tube (the site's hero): #000 glass, radius 48, inner rim #ffffff14, scanlines
         every 4 px at 42 %, RGB fringe -5 px #2141ff / +5 px #ff2a12 on glyphs, a soft roll band, sync jumps
         of 4-8 px on fixed frames. No glow, no bloom.
OBJECTS: tube with ten "?" in a row (one per agent waiting on you); the "?" dot is the carrier.
         Sidebar section at 2.4x: "acme-web 3" header, rows Session cookie migration (needs you → running → done),
         Checkout performance (running), Fix mobile nav jitter (done) — the app's SessionRow and StatusGlyph.
         Git graph: main (#a1a1a1, 6 px) and four lanes with labels (mono 30 px) and head glyphs;
         session-cookie merges, its head node travels the merge curve and lands as the white merge dot.
         Keycap HUD (as film A): J "Jump to it", 1 "Answer it", ⇧⌘M "Merge it".
         WAVI mark as SVG text: chrome gradient (#cfd8ff → #fff → #ffd3e8 → #fff6cd) over the RGB fringe.
MOTION:  carrier zooms: in power3.in 0.5 s (blur to 14 px), out expo.out 0.8 s from the same shape at the same
         size and place (a dot of 280 px at frame centre) — every world change is a match cut on the dot.
         Titles: per word blur 6 → 0 in 0.13 s, 0.067 s apart; Bodoni lines per letter, 1 frame apart, hard cut out.
         UI state changes are instant swaps (the app does not animate status). Exits 0.15 s power3.in.
SHOTS:
  1 tube    f0-135    frame 0: the lit tube, ten magenta "?" with sync jumps and one-frame flicker; "Ten agents."
                      (f9-45) then "Waiting on you." (f48-93) under it; keycap J (f93), press f102: the first "?"
                      stays, the other nine dim to 45 %; f120-135 zoom into its dot.  sfx: glitch-3 hum, key, whoosh
  2 row     f135-255  the dot is the needs-you glyph; pull back to the sidebar section; keycap 1 "Answer it",
                      press f183: glyph -> running, "Running pnpm test auth"; f219 -> done;
                      f240-255 zoom into the green glyph.                          sfx: click, pop, whoosh
  3 graph   f255-375  the green dot is session-cookie's head node; pull back to four lanes over main;
                      keycap ⇧⌘M "Merge it", press f293: the merge curve draws and the node rides it to main,
                      lands as the white merge dot f309; f360-375 zoom into it.     sfx: key, pop, whoosh
  4 tube2   f375-495  the white dot is the first answered "?" (hook gone, dot kept); pull back; nine more answered
                      on 16ths (f402-438); ALL RUNNING f438; f480-495 the tube switches off to a line.  sfx: typing, glitch
  5 type    f495-585  hard cut on the beat: "BRANCH OUT." printed letter by letter (f495-540), hard cut on the beat:
                      "MERGE IN." 250 px (f540-585), Bodoni on grain.               sfx: two bass impacts
  6 end     f585-735  the tube switches back on and shows the WAVI mark on its screen; "Download for macOS" and
                      "Free · open source · no telemetry" below (f615); hold to the end.  sfx: glitch, pop
BANNED:  an empty frame on a cut (found and fixed at 18.0 s); a dark void with small things floating (the tube is >= 70 % of the frame width, the UI at 2.4x);
         glow, bloom, particles, lens flares; purple/blue gradients; glass cards; tilted UI;
         everything fading and sliding up; a title over a dimmed screenshot; the logo docked in a corner;
         an end card that copies film A (A puts the mark above the tube; B's mark lives inside the tube);
         invented UI; any number presented as measured.
QA:      f0 (lit tube, ten "?", never black) · f30 ("Ten agents." readable) · f110 (J pressed, one "?" lit) ·
         f150 (row readable, magenta glyph) · f230 (done) · f315 (merge dot on main) · f440 (ALL RUNNING) ·
         f505 (BRANCH OUT.) · f560 (MERGE IN.) · f720 (WAVI in the tube, Download for macOS).
```

## Notes

- Copy is the site's own wherever it exists ("BRANCH OUT. / MERGE IN.", "ALL RUNNING", "Download for macOS", "no telemetry");
  "Ten agents. / Waiting on you." follows the site's hero caption (ten "?" are ten agents waiting on you).
- Session data are the English site's replica sessions; the app's own UI is Chinese.
