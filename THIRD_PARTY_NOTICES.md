# Third-party notices

Code adapted from other projects is listed here, one entry per source file, with the upstream path, commit and license.
Only MIT / Apache-2.0 / BSD sources may be adapted (see docs/PRD.md §6.5). Ideas from GPL / AGPL / ELv2 projects are fine; their code is not.

| Our file | Upstream | License |
|---|---|---|
| `src/renderer/terminal/tui-wheel.ts` | [stablyai/orca](https://github.com/stablyai/orca) `src/renderer/src/lib/pane-manager/pane-terminal-tui-wheel-reports.ts` @ `f2fb8ff9` (wheel → report count; the replay approach in `xterm-surface.ts` follows `pane-terminal-mouse-wheel.ts`) | MIT, Copyright (c) 2026 Lovecast Inc. |
| `src/pty-host/headless-mirror.ts` | [stablyai/orca](https://github.com/stablyai/orca) `src/main/daemon/terminal-mode-rehydrate-sequences.ts` @ `37beafdd` (`modeSequences`; the per-session headless emulator follows `headless-emulator.ts`) | MIT, Copyright (c) 2026 Lovecast Inc. |
| `src/renderer/terminal/reattach-payload.ts` | [stablyai/orca](https://github.com/stablyai/orca) `src/renderer/src/components/terminal-pane/pty-connection/apply-reattach-payload.ts` @ `37beafdd` (reattach replay steps: clean slate, screen, modes, seq baseline) | MIT, Copyright (c) 2026 Lovecast Inc. |
| `patches/@xterm+addon-webgl+0.19.0.patch` | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) `addons/addon-webgl` 0.19.0 (patched at install by `patch-package`: transparent default background in `RectangleRenderer`, separate alpha blend in `GlyphRenderer`; remove once xterm.js#6116 is fixed upstream) | MIT, Copyright (c) 2018 The xterm.js authors |
| `ios/Packages/Ristretto255/Sources/CRistretto255/*` (ed25519_ref10.c, core_ed25519.c, core_ristretto255.c, scalarmult_ristretto255_ref10.c and their headers, unchanged; `shim.c` copies `sodium_is_zero` / `sodium_add` / `sodium_sub` from `sodium/utils.c`) | [jedisct1/libsodium](https://github.com/jedisct1/libsodium) 1.0.20-RELEASE @ `9511c982` (the ristretto255 group for the typed-code PAKE; the prebuilt swift-sodium binary is the minimal build without it) | ISC (a BSD-family licence), Copyright (c) 2013-2024 Frank Denis; full text in `ios/Packages/Ristretto255/LICENSE-libsodium` |
| `ios/Wavi/Net/JSONValue.swift`, `ios/Wavi/Store/Keychain.swift`, `ios/Wavi/Views/PairView.swift` (`QRScanner`), `ios/Wavi/Net/RemoteClient.swift` (generation guard) | marvis-coding-agent (the author's own) `packages/ios/Marvis/Net/JSONValue.swift`, `Store/HostStore.swift`, `Views/PairView.swift`, `Net/RpcClient.swift` | MIT, Copyright (c) 2026 Jacoy |

Bundled assets:

- JetBrains Mono — SIL Open Font License 1.1, via `@fontsource-variable/jetbrains-mono` (desktop) and the TTFs in `ios/Wavi/Resources/Fonts/` with `OFL.txt` (iPhone app).
- Lucide icons (desktop through `lucide-react`; the iPhone app's `ios/Wavi/Assets.xcassets/Lucide` rendered from it) — ISC, Copyright (c) Lucide Contributors.
- Website fonts (`site/src/assets/fonts/`, subsets downloaded from Google Fonts): Archivo, Noto Sans SC, Noto Serif SC — SIL Open Font License 1.1.
- Website scripts (bundled by Astro from npm): GSAP 3.15 — GSAP Standard “No Charge” License; Lenis 1.3 — MIT.
- Liquid Glass shell: `electron-liquid-glass` 1.1.1 (npm, with its prebuilt N-API binaries) — MIT, Copyright (c) Meridius Labs.
- Agent logos (`src/shared/agent-icon-svg.ts`, used by the desktop and the phone app): generated from the one-colour (mono) files of `@lobehub/icons-static-svg` 1.99.0 — MIT, Copyright (c) LobeHub. The logos themselves are trademarks of Anthropic, OpenAI, Google, xAI, Alibaba, Moonshot AI, Amp, Kiro, Cline, Block, Cursor, GitHub, Tencent and the other owners of the CLIs they stand for; Wavi shows them only to say which CLI runs in a session.
