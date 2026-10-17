# Third-party notices

Code adapted from other projects is listed here, one entry per source file, with the upstream path, commit and license.
Only MIT / Apache-2.0 / BSD sources may be adapted (see docs/PRD.md §6.5). Ideas from GPL / AGPL / ELv2 projects are fine; their code is not.

| Our file | Upstream | License |
|---|---|---|
| `src/renderer/terminal/tui-wheel.ts` | [stablyai/orca](https://github.com/stablyai/orca) `src/renderer/src/lib/pane-manager/pane-terminal-tui-wheel-reports.ts` @ `f2fb8ff9` (wheel → report count; the replay approach in `xterm-surface.ts` follows `pane-terminal-mouse-wheel.ts`) | MIT, Copyright (c) 2026 Lovecast Inc. |
| `src/pty-host/headless-mirror.ts` | [stablyai/orca](https://github.com/stablyai/orca) `src/main/daemon/terminal-mode-rehydrate-sequences.ts` @ `37beafdd` (`modeSequences`; the per-session headless emulator follows `headless-emulator.ts`) | MIT, Copyright (c) 2026 Lovecast Inc. |
| `src/renderer/terminal/reattach-payload.ts` | [stablyai/orca](https://github.com/stablyai/orca) `src/renderer/src/components/terminal-pane/pty-connection/apply-reattach-payload.ts` @ `37beafdd` (reattach replay steps: clean slate, screen, modes, seq baseline) | MIT, Copyright (c) 2026 Lovecast Inc. |

Bundled assets:

- JetBrains Mono — SIL Open Font License 1.1, via `@fontsource-variable/jetbrains-mono`.
