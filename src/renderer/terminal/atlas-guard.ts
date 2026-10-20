// What to do when a WebGL glyph atlas grew. addon-webgl 0.19 merges four atlas pages into one once an atlas holds
// `maxAtlasPages` (min(32, MAX_TEXTURE_IMAGE_UNITS): 16 on Apple GPUs, never less in WebGL2), and the merge leaves
// renderers drawing glyphs from the wrong texture — garbled text that stays until the atlas is rebuilt (xterm.js
// #5847; fixed upstream by #5883 / #6042 / #6043 / #6055, released after 0.19.0; e2e/webgl-cjk-stress.spec.ts).
// Chinese fills pages fast: every character in every color and attribute is its own glyph, ~270 to a 512² page at
// 2×. So XtermSurface starts the renderers on a new atlas well before one would merge. Drop this with
// addon-webgl ≥ 0.20.

/** Pages an atlas may grow to; the rest (4 of 16) is room for a frame that adds several pages at once. */
export const ATLAS_MAX_PAGES = 12

/**
 * - `recreate`: recreate every WebGL renderer, which gives them a new, empty atlas. Clearing the atlas in place
 *   (clearTextureAtlas) is not enough in 0.19: a cleared atlas packs glyphs worse than a new one (redrawing one
 *   screen into 12 cleared pages needed a 13th, a new atlas holds it in about 7), clearTexture() does nothing when
 *   page 0 is a merged page, and after a merge renderers may keep stale textures.
 * - `dom`: the frame drawn right after a reset filled the atlas again, so the screen alone does not fit; draw it
 *   with the DOM renderer until it is shown again.
 */
export type AtlasAction = 'none' | 'recreate' | 'dom'

export function atlasAction(input: { merged: boolean; pages: number; justReset: boolean }): AtlasAction {
  if (!input.merged && input.pages < ATLAS_MAX_PAGES) return 'none'
  return input.justReset ? 'dom' : 'recreate'
}
