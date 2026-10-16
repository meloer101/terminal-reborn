// The right panel has nothing to show until M4 (changes) / M5 (graph), so its entry points — the header
// toggle and the ⌘K action — stay hidden (phase 2b · B11). Dev and e2e runs opt in with `globalThis.__TR_PANEL__`
// to work on the panel and its layout (B13).
export const RIGHT_PANEL_AVAILABLE = (globalThis as { __TR_PANEL__?: boolean }).__TR_PANEL__ === true
