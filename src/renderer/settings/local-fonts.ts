// Installed-font discovery through the Local Font Access API (Chromium `queryLocalFonts`).
// Needs the `local-fonts` permission; when it is denied or missing we fall back to the bundled
// defaults and the user can still type any family name.
import { useEffect, useState } from 'react'
import { classifyFonts, type FontCatalog } from './fonts'

interface LocalFontData {
  family: string
}

type QueryLocalFonts = () => Promise<LocalFontData[]>

export type FontAccess = 'loading' | 'ready' | 'denied' | 'unsupported'

export interface FontCatalogState {
  catalog: FontCatalog
  access: FontAccess
}

const FALLBACK: FontCatalog = classifyFonts([])

/** Canvas check: a monospace face renders narrow and wide glyphs at the same advance. */
function monospaceMeasurer(): (family: string) => boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return () => false
  return (family) => {
    ctx.font = `32px "${family.replace(/"/g, '')}", serif`
    const narrow = ctx.measureText('iiiiiiii').width
    const wide = ctx.measureText('MMMMMMMM').width
    return narrow > 0 && Math.abs(narrow - wide) < 0.01
  }
}

async function loadCatalog(): Promise<FontCatalogState> {
  const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts
  if (typeof query !== 'function') return { catalog: FALLBACK, access: 'unsupported' }
  try {
    const faces = await query.call(window)
    return { catalog: classifyFonts(faces.map((face) => face.family), monospaceMeasurer()), access: 'ready' }
  } catch (error) {
    // NotAllowedError / SecurityError: permission denied. Anything else: treat the same way.
    console.warn('[settings] queryLocalFonts failed:', error)
    return { catalog: FALLBACK, access: 'denied' }
  }
}

export function useFontCatalog(): FontCatalogState {
  const [state, setState] = useState<FontCatalogState>({ catalog: FALLBACK, access: 'loading' })
  useEffect(() => {
    let cancelled = false
    void loadCatalog().then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
