import { describe, expect, it, vi } from 'vitest'
import { deferSelectionRedrawWhilePaused } from './paused-selection'

/** The slice of xterm 6.0's RenderService the patch touches. */
function fakeTerminal() {
  const renderer = vi.fn()
  const service = {
    _isPaused: false,
    _needsSelectionRefresh: false,
    _selectionState: { start: undefined as [number, number] | undefined, end: undefined as [number, number] | undefined, columnSelectMode: false },
    handleSelectionChanged(start: [number, number] | undefined, end: [number, number] | undefined, columnSelectMode: boolean) {
      this._selectionState.start = start
      this._selectionState.end = end
      this._selectionState.columnSelectMode = columnSelectMode
      renderer(start, end, columnSelectMode)
    }
  }
  return { term: { _core: { _renderService: service } }, service, renderer }
}

describe('deferSelectionRedrawWhilePaused', () => {
  it('passes selection changes through to the renderer while the terminal is on screen', () => {
    const { term, renderer } = fakeTerminal()
    expect(deferSelectionRedrawWhilePaused(term)).toBe(true)
    term._core._renderService.handleSelectionChanged([0, 1], [5, 1], false)
    expect(renderer).toHaveBeenCalledWith([0, 1], [5, 1], false)
  })

  it('only remembers them while paused, and asks for the selection to be drawn with the next render', () => {
    const { term, service, renderer } = fakeTerminal()
    deferSelectionRedrawWhilePaused(term)
    service._isPaused = true
    for (let i = 0; i < 100; i++) service.handleSelectionChanged(undefined, undefined, false)
    service.handleSelectionChanged([2, 3], [4, 3], true)
    expect(renderer).not.toHaveBeenCalled()
    expect(service._selectionState).toEqual({ start: [2, 3], end: [4, 3], columnSelectMode: true })
    expect(service._needsSelectionRefresh).toBe(true)
  })

  it('leaves terminals alone whose internals look different', () => {
    expect(deferSelectionRedrawWhilePaused({})).toBe(false)
    expect(deferSelectionRedrawWhilePaused(null)).toBe(false)
    expect(deferSelectionRedrawWhilePaused({ _core: { _renderService: { handleSelectionChanged() {} } } })).toBe(false)
  })
})
