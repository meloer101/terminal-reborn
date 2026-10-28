# Materials

What the film is made of, and where each piece came from. Real material first: the logo as a file, the product's own colours and type, its real interface. Anything rebuilt is traced over a capture listed here.

## Web · https://wavi-pi.vercel.app  (2026-10-27)

- Logo / icon (2): `materials/web-wavi-pi-vercel-app/logo-01.png` icon 64x64, `materials/web-wavi-pi-vercel-app/logo-02.png` apple-touch-icon
- Screenshots of the page (8): `materials/web-wavi-pi-vercel-app/screen-01.png` y=0px, 2x, `materials/web-wavi-pi-vercel-app/screen-02.png` y=900px, 2x, `materials/web-wavi-pi-vercel-app/screen-03.png` y=1800px, 2x, `materials/web-wavi-pi-vercel-app/screen-04.png` y=2700px, 2x, `materials/web-wavi-pi-vercel-app/screen-05.png` y=3600px, 2x, `materials/web-wavi-pi-vercel-app/screen-06.png` y=4500px, 2x, `materials/web-wavi-pi-vercel-app/screen-07.png` y=5400px, 2x, `materials/web-wavi-pi-vercel-app/screen-08.png` y=6300px, 2x
- Images (1): `materials/web-wavi-pi-vercel-app/image-01.png` 2880×1800 "background"
- Colours it uses: #000000 (ground) · #050505 (ground) · #0a0a0a (ground) · #0e0e0e (ground) · #c4c4c4 (type) · #eeeeee (type) · #6b6b6b (type) · #eeeeee (accent) · #3a3a3a (accent) · #000000 (accent)
- Typefaces: -apple-system · JetBrains Mono Web · Wavi Archivo
- Not captured: page continues below 7200px (raise --shots); image https://wavi-pi.vercel.app/%23f

## App · this repo's own README captures (2026-10-27)

- `materials/app-readme/{hero,overview,review,merge,new-session}-dark.png`: real Wavi window, dark theme (from `docs/assets/readme/`)
- `materials/app-readme/{banner,workflow,compare,branch-out-merge-in}.jpg`: README banner and workflow stills
- `materials/app-readme/icon.svg`: the app icon (`build/icon.svg`), the real logo file
- Colours (product): #050505 ground, magenta #ff5fb0 only on what waits on the user (CLAUDE.md, STORYLINES.md)
- Type: Archivo (titles), Bodoni Moda (site hero), JetBrains Mono

## App · captures from the built app over demo repos (2026-10-27)

Made by `tools/capture.spec.ts` (Playwright Electron, throwaway profile, the same demo repos and fixtures as `scripts/readme-shots`; no real sessions or private data). 1440×900 window at 2x → 2880×1800.

- `materials/app-capture/split-dark.png` / `split-light.png`: 2×2 split, one session per pane with live git graph, diff and `npm test` output
- `materials/app-capture/split-dracula.png` / `split-nord.png`: the same split with an imported terminal theme (Dracula and Nord palettes, both MIT) and a custom terminal background: the 导入主题 feature
- `materials/app-capture/settings-appearance-dark.png` / `-light.png`: 设置 · 外观: theme, fonts, terminal colour, opacity, live preview
- Sidebar status rows (running / waiting / done / error) are the fixtures' `demoData()`; status text is real UI copy.
