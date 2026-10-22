# SPEC — Wavi teaser B, "Ten question marks"

```text
GOAL:    in 24 s a stranger gets "ten agents are waiting on me; Wavi answers them one by one" and remembers the tube.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, English on screen, no voice.
TIME:    24 s x 30 = 720 frames. Grid 120 BPM = 15 frames a beat, 60 a bar; every scene seam is on a bar
         (4, 8, 12, 16 s), the type cuts on beats (16.0, 17.5), the nine fast answers on 16ths (0.125 s).
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
  1 tube    f0-120    frame 0: the lit tube, ten magenta "?" with jitter; "Ten agents." (f9-42) then
                      "Waiting on you." (f45-87) under it; keycap J (f90), press f96: the first "?" brightens,
                      the rest dim to 45 %; f105-120 zoom into its dot.            sfx: glitch-3 hum, key, whoosh
  2 row     f120-240  the dot is the needs-you glyph; pull back to the sidebar section; keycap 1 "Answer it",
                      press f159: glyph → running, activity → "Running pnpm test auth"; f198 → done;
                      f222-240 zoom into the green glyph.                          sfx: key, pop, whoosh
  3 graph   f240-360  the green dot is session-cookie's head node; pull back to four lanes over main;
                      keycap ⇧⌘M "Merge it", press f278: the merge curve draws and the node rides it to main,
                      lands as the white merge dot f294; f342-360 zoom into it.     sfx: key, pop, whoosh
  4 tube2   f360-480  the white dot is the first answered "·" in the tube; pull back; nine "?" answered on 16ths
                      (f387-420); ALL RUNNING f423; f465-480 the tube switches off to a line.  sfx: typing, glitch
  5 type    f480-570  hard cut on the bar: "BRANCH OUT." (f480-525), hard cut on the beat: "MERGE IN." (f525-570),
                      Bodoni 250 px on grain.                                       sfx: two bass impacts
  6 end     f570-720  the tube switches back on and shows the WAVI mark on its screen; "Download for macOS" and
                      "Free · open source · no telemetry" below (f600); hold to the end.  sfx: glitch, pop
BANNED:  a dark void with small things floating (the tube is >= 70 % of the frame width, the UI at 2.4x);
         glow, bloom, particles, lens flares; purple/blue gradients; glass cards; tilted UI;
         everything fading and sliding up; a title over a dimmed screenshot; the logo docked in a corner;
         an end card that copies film A (A puts the mark above the tube; B's mark lives inside the tube);
         invented UI; any number presented as measured.
QA:      f0 (lit tube, ten "?", never black) · f30 ("Ten agents." readable) · f100 (J pressed, one "?" lit) ·
         f150 (row readable, magenta glyph) · f210 (done) · f300 (merge dot on main) · f430 (ALL RUNNING) ·
         f500 (BRANCH OUT.) · f550 (MERGE IN.) · f700 (WAVI in the tube, Download for macOS).
```

## Notes

- Copy is the site's own wherever it exists ("BRANCH OUT. / MERGE IN.", "ALL RUNNING", "Download for macOS", "no telemetry");
  "Ten agents. / Waiting on you." follows the site's hero caption (ten "?" are ten agents waiting on you).
- Session data are the English site's replica sessions; the app's own UI is Chinese.
