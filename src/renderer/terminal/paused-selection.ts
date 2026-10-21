// Hidden terminals must cost nothing to draw. xterm 6.0 refreshes the selection on every scroll (CoreBrowserTerminal:
// `onScroll → selectionService.refresh()`), and RenderService.handleSelectionChanged hands that to the renderer even
// while the renderer is paused because the terminal is off screen (refreshRows checks the pause, this does not). The
// DOM renderer answers every selection change by redrawing all of its rows and measuring their glyphs. Wavi's hidden
// terminals run on the DOM renderer (they give their WebGL context back, xterm-surface.ts setVisible), so each hidden
// session that prints redrew its whole screen every frame: with 19 of 20 sessions streaming, frames took 100–500 ms
// and keys waited up to 1.7 s (e2e/scale.spec.ts, 2026-10-20). While paused, the selection is only remembered; the
// render that follows unpausing applies it (RenderService._renderRows checks `_needsSelectionRefresh`).
// Relies on three RenderService internals; when they are missing (another xterm version) nothing is patched.

type Point = [number, number] | undefined

interface RenderServiceInternals {
  _isPaused: boolean
  _needsSelectionRefresh: boolean
  _selectionState: { start: Point; end: Point; columnSelectMode: boolean }
  handleSelectionChanged(start: Point, end: Point, columnSelectMode: boolean): void
}

function renderServiceOf(term: unknown): RenderServiceInternals | null {
  const service = (term as { _core?: { _renderService?: Partial<RenderServiceInternals> } } | null)?._core?._renderService
  if (!service || typeof service.handleSelectionChanged !== 'function') return null
  if (typeof service._isPaused !== 'boolean' || typeof service._needsSelectionRefresh !== 'boolean') return null
  if (typeof service._selectionState !== 'object' || service._selectionState === null) return null
  return service as RenderServiceInternals
}

/** Patches an opened xterm Terminal; returns whether it could. */
export function deferSelectionRedrawWhilePaused(term: unknown): boolean {
  const service = renderServiceOf(term)
  if (!service) return false
  const original = service.handleSelectionChanged.bind(service)
  service.handleSelectionChanged = (start, end, columnSelectMode) => {
    if (!service._isPaused) {
      original(start, end, columnSelectMode)
      return
    }
    service._selectionState.start = start
    service._selectionState.end = end
    service._selectionState.columnSelectMode = columnSelectMode
    service._needsSelectionRefresh = true
  }
  return true
}
