import { useEffect, useRef } from 'react'
import type { AppearanceSettings } from '@shared/settings'
import { buildFontStack } from '../terminal/appearance'
import { XtermSurface } from '../terminal/xterm-surface'
import { sampleRows, sampleScreen } from './preview-sample'
import styles from './PreviewTerminal.module.css'

type PreviewAppearance = Pick<AppearanceSettings, 'latinFont' | 'cjkFont' | 'fontSize' | 'lineHeight' | 'ligatures'>

function toSurface(a: PreviewAppearance) {
  return { fontFamily: a.latinFont, cjkFontFamily: a.cjkFont, fontSize: a.fontSize, lineHeight: a.lineHeight, ligatures: a.ligatures }
}

/**
 * A standalone xterm surface (no PTY) fed a sample session. It re-lays out on every appearance
 * change so the card is exactly as tall as the sample (soft wraps included).
 */
export function PreviewTerminal({ appearance }: { appearance: PreviewAppearance }) {
  const host = useRef<HTMLDivElement>(null)
  const surface = useRef<XtermSurface | null>(null)
  const latest = useRef(appearance)
  useEffect(() => {
    latest.current = appearance
  })

  // Resizes the host so the grid has exactly the rows the sample needs, then fits and (via onResize) replays the sample.
  const layout = useRef(() => {})
  useEffect(() => {
    layout.current = () => {
      const el = host.current
      const term = surface.current
      if (!el || !term) return
      const { cols, rows } = term.fit()
      const screen = el.querySelector<HTMLElement>('.xterm-screen')
      if (!screen || rows === 0 || screen.offsetHeight === 0) return
      const cell = screen.offsetHeight / rows
      const target = Math.ceil(cell * sampleRows(cols))
      if (Math.abs(el.offsetHeight - target) > 1) {
        el.style.height = `${target}px`
        term.fit()
      }
    }
  })

  useEffect(() => {
    const el = host.current
    if (!el) return
    // DOM renderer: a WebGL preview would share (and clear) the glyph atlas of the session terminals.
    const term = new XtermSurface({ webgl: false })
    surface.current = term
    term.setAppearance(toSurface(latest.current))
    const resize = term.onResize(() => term.write(sampleScreen()))
    const observer = new ResizeObserver(() => layout.current())
    observer.observe(el)
    term.mount(el)
    void term.whenOpen().then(() => {
      term.write(sampleScreen())
      layout.current()
    })
    return () => {
      observer.disconnect()
      resize.dispose()
      surface.current = null
      term.dispose()
    }
  }, [])

  const { latinFont, cjkFont, fontSize, lineHeight, ligatures } = appearance
  useEffect(() => {
    const term = surface.current
    if (!term) return
    term.setAppearance({ fontFamily: latinFont, cjkFontFamily: cjkFont, fontSize, lineHeight, ligatures })
    layout.current()
    term.write(sampleScreen())
  }, [latinFont, cjkFont, fontSize, lineHeight, ligatures])

  return (
    <div
      className={styles.preview}
      role="img"
      aria-label="终端预览"
      data-testid="preview-terminal"
      data-font-stack={buildFontStack({ fontFamily: latinFont, cjkFontFamily: cjkFont })}
      data-font-size={fontSize}
    >
      <div ref={host} className={styles.host} inert />
    </div>
  )
}
