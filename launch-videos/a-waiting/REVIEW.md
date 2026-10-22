# Review

## 1.5x cut with music (2026-10-22)

- Plays at 1.5x: each scene keeps its 1x authoring and is wrapped in a parent timeline with `timeScale(SPEED)`; clip times in the HTML are already divided by 1.5. Film is 29 s.
- Music: "do robots have a god?" by smilingcynic (ccMixter, CC BY 3.0, 120 BPM; credit in assets/sfx/CREDITS.md). It starts on a beat at t=0 from 12.045 s into the track, sits muffled (lowpass 900 Hz) and low through the old way, dips under the punch-in, and opens at 6.5 s when Wavi appears; 1.5 s fade-out.
- Retimed to the music: ⌘1-⌘4 hops on beats 1.0-2.5 s, punch-in 3.0, notification 7.0, ⌘J 10.0, ⇧⌘M 16.0, Merge 17.0, branch merges 19.0 / 19.5 / 20.0 / 20.5, claim cut 23.0, tube 24.5, ALL RUNNING 25.5, WAVI 26.0. Two beats were added between "Who's waiting?" and "You'll know at a glance." so both can be read at 1.5x.
- Fixed: terminal output after answering sat at the bottom of the frame (a CSS specificity bug, also in the 1x renders).
- Mix measured, not heard: project render -17.9 LUFS; renders/wavi-a-1.5x.mp4 is loudness-normalised with ffmpeg to -14.9 LUFS, -2 dBTP.
- Kept warnings: "You'll know at a glance." holds 1.56 s (floor 1.72 s); BRANCH OUT. is a per-letter false positive.
- The music was picked by tags and spectrogram without listening; alternatives found on ccMixter (CC BY): "Saturdays Basement" by cdk (128 BPM, electro/funky), "tonight" by smilingcynic (120 BPM, dance/funky rock), "Zest" by basematic (funky guitar).

# Review — first cut (2026-10-22)

## Creative calls

- Built storyline A, "The one that's waiting" (40 s, 16:9, English, no voice). Not built: B "Ten question marks" (its CRT tube became the end card) and C "One task, three answers" (see STORYLINES.md).
- Product UI is rebuilt from the app's own components and tokens at 2x (SessionRow, StatusGlyph, merge sheet labels, Changes panel), with the English site's replica sessions. The app's UI is Chinese today, so the English labels are a translation, the same one the English site uses.
- Copy is the site's own: "Who's waiting? / You'll know at a glance.", "BRANCH OUT. / MERGE IN.", "One person, many threads.", "Download for macOS", "no telemetry". "It waited 23 minutes." and all session data are illustrative.
- Verbs are carried by the real shortcuts as keycaps (⌘1-⌘5 in the old way, ⌘J, 1, ⇧⌘M in Wavi).
- Fonts: the site's Archivo and Bodoni subsets; Inter stands in for SF Pro (the renderer cannot address the system font); JetBrains Mono for terminals.

## Measured vs looked at

- `check`: passes (0 errors). Warnings kept on purpose:
  - `text_below_floor` on the wall's pane headers (14 px texture, never meant to be read) and on the sidebar's activity line (24 px = the app's 12 px caption at 2x; the waiting row's line is repeated at 28 px in the notification).
  - `contrast_aa_failure` on the pane headers (#6b6b6b, the app's tertiary text).
  - `line_unread` during the fold and the zoom-through (rows and diff are in motion, not meant to be read there).
  - `composition_file_too_large` on wall.html (eight terminals of static text).
- Looked at: the beat sheet, every seam (wall→app is frame-identical), the phone sheet (titles read at 360 px; sidebar rows do not, the titles carry those beats).
- Sound: 26 effects from the bundled Pixabay library, each placed so its measured peak lands one frame after its picture. Nobody has heard the mix; levels are set by measured LUFS, not by ear. There is no music yet.

## Weakest shot

- The wall (0-2 s) asks the viewer to spot the one still pane among eight; the need only becomes explicit with the focus hops and the punch-in at ~5 s. With more time: dim the seven busy panes 10 % once the hops start, or open on the stuck pane and pull out to the wall.
- The graph (26-33 s) is the payoff but its moves are small (curves drawing into main). A camera drift along main as each lane lands would give it more weight.

## Open

- Music: needs a source (HeyGen sign-in for the catalog, or local generation, or the author's own track).
- zh cut: swap the variables and the replica copy to the app's real Chinese labels.
