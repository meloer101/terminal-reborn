# E · Linear changelog (huashu-motion) — treatment

Chosen direction: A · Linear changelog (one continuous take, flat-world camera). 30 s, 16:9 1920×1080, 112 BPM (beat 0.536 s, bar 2.143 s, 14 bars). Sound-led, no narration. Engine: huashu-motion (`om`), separate from the HyperFrames films a–d.

The one thing: Wavi is a terminal built for one developer running many agents at once; you see every thread at a glance and nothing steps on anything else.

Selling points, in film order (user brief 2026-10-27): ① overview shows each window's live status ② multi-window, smooth side-by-side ③ appearance you can make your own ④ almost every model vendor ⑤ automatic commit / PR / code review.

## Route and energy

Hybrid. A continuous spine (one camera over one world of real captures) broken open by two bursts: bar 7–8 (four theme flips, one per beat) and bar 11–12 (five cuts on the beat). Hook inside 3 s. Slow-down: bar 3 is one held answer; bar 13 is the pull-out. Energy: bars 1–3 rising, 4–6 steady, 7–8 burst, 9–10 breath, 11–12 peak, 13–14 release.

## Look

Ground #050505 with a soft screen glow, surface #0e0e0e, ink #eeeeee, muted #6b6b6b, accent #ff5fb0 only for "waiting on you" (the ring, the glyph, the one word in a headline). Archivo 900 condensed for headlines (the repo's own subset, `assets/fonts/archivo-wdth-wght-subset.woff2`); the app's own type inside captures. Captures are 2x; headlines in English like the site's hero, UI in the product's Chinese.

## Beat map (time at 112 BPM)

| bar.beat | time | what happens | camera / language move | sound |
|---|---|---|---|---|
| 1.1 | 0.00 | Frame 0 = poster: "Every thread, at a glance." over the real overview window | camera already creeping in | pad in, soft tick |
| 1.3 | 1.07 | sidebar rows' status glyphs settle; one row rings magenta | push toward the row | pop |
| 2.1 | 2.14 | label "1 waiting." lands | ring pulses once | thud |
| 2.3 | 3.21 | ⌘J keycap flies in; camera whips to the terminal with the permission prompt | whip pan (motion blur) | whoosh, key |
| 3.1 | 4.29 | "1" typed, prompt resolves, row glyph goes magenta → spinner | hold, nothing else moves | key, soft hit |
| 3.3 | 5.36 | caption "Answer it. It keeps going." | — | tick |
| 4.1 | 6.43 | whip pan right into the 2×2 split; headline "Four threads. One screen." | motion blur | whoosh, hit |
| 4.1–4.4 | 6.43–8.57 | panes appear one per beat, each starts streaming (line reveal) | camera drifts across | 4 hits |
| 5–6 | 8.57–12.86 | camera glides through the split; sidebar spinners turn, outputs scroll; caption "Side by side. Smooth." | slow push, parallax between panes | pad, ticks |
| 7.1–7.4 | 12.86–15.00 | burst: split flips dark → light → Dracula → Nord, one per beat; caption "Make it yours." | in-place cut, same framing | 4 hits |
| 8.1 | 15.00 | 设置 · 外观 slides over the split, 导入主题 highlighted | camera dips into dialog | whoosh |
| 9.1–10.4 | 17.14–21.43 | names stream: Claude Code, Codex, Gemini CLI … 19 of them; headline "19 agents. One window." (needs your OK) | camera slides to the 智能体 page | hit per 3 names |
| 11.1–12.1 | 21.43–25.71 | five cuts on the beat: diff + comment · 合并到 main · merge sheet · 设置 · 自动化 · git graph; captions "Review." "Commit." "PR." "Merge." | cuts, one real capture each | hits |
| 13.1 | 25.71 | camera pulls all the way out through every capture to the full window | pull-out | riser → drop |
| 13.3 | 27.86 | "One person, many threads." | hold | — |
| 14.1 | 28.93 | WAVI mark, "Download for macOS", small huashu-motion signature in the last 1.2 s | hold | last hit, tail |

## Four stills to check

Hook (0.4 s): headline + overview window. Hero (8.0 s): the 2×2 split with all four panes lit. Densest (23 s): the cut sequence mid-burst. End (29.5 s): WAVI + Download for macOS.

## Continuity chain

overview row (magenta glyph) → the same glyph in the sidebar of the split → the split's panes → the same panes in a new theme → the settings dialog over the split → the agent names leaving the dialog → the diff in a pane → the merge dot on the git graph → the whole window pulling back.

## Real material map

- Overview, review/diff, git graph, merge sheet: `materials/app-readme/*-dark.png`
- 2×2 split live output, imported themes (Dracula / Nord): `materials/app-capture/split-*.png`
- 外观 / 智能体 / 自动化 settings: `materials/app-capture/settings-*.png`
- Headline copy and CTA: from the site (`site/src/i18n.ts`); logo: `materials/app-readme/icon.svg`
- Moving panes are rebuilt from the captures (stepped line reveal, spinner glyphs redrawn), never a screenshot panned around.

## Sound

Composer mode: a dry electronic pulse (sub, tight clicks, a soft keys line) at 112 BPM, built to the bar-11 peak, a riser into bar 13. Hits on every landing (about 25). Music world chosen from the product's character; no vocals.

## Open decisions / risks

1. "19 agents": PRD §6.15 counts launchable CLIs; some were not tried against the real CLIs. The line needs the author's OK.
2. The signature "Made with huashu-motion" stays on the end frame (switch-off is `data-om-signature="off"`).
3. Chinese UI inside English headlines is deliberate (real product); a fully Chinese cut is a variable swap later.
