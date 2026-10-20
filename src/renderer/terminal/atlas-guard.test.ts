import { describe, expect, it } from 'vitest'
import { ATLAS_MAX_PAGES, atlasAction } from './atlas-guard'

describe('atlasAction', () => {
  it('leaves an atlas alone until it nears the merge point', () => {
    expect(atlasAction({ merged: false, pages: 1, justReset: false })).toBe('none')
    expect(atlasAction({ merged: false, pages: ATLAS_MAX_PAGES - 1, justReset: false })).toBe('none')
  })

  it('starts the renderers on a new atlas once one reaches the limit', () => {
    expect(atlasAction({ merged: false, pages: ATLAS_MAX_PAGES, justReset: false })).toBe('recreate')
  })

  it('does the same after a merge, however few pages are left', () => {
    expect(atlasAction({ merged: true, pages: 3, justReset: false })).toBe('recreate')
  })

  it('falls back to the DOM renderer when the frame after a reset fills the atlas again', () => {
    expect(atlasAction({ merged: false, pages: ATLAS_MAX_PAGES, justReset: true })).toBe('dom')
    expect(atlasAction({ merged: true, pages: 14, justReset: true })).toBe('dom')
    expect(atlasAction({ merged: false, pages: 2, justReset: true })).toBe('none')
  })
})
