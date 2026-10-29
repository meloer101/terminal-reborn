// Wavi's boot screen (PRD F18 · Figma 39I/39J, "B1 聚"): from the window's first frame until React has drawn the shell.
// A classic script outside the app bundle (index.html), so it runs while that bundle is still loading. It
//  - sets <html data-theme> from the theme mirror (renderer/theme.ts), so the first frame has the right colours;
//  - draws the content card where the welcome page last measured it (the layout mirror, app-shell/boot.ts), and over it
//    a canvas on which boot-worker.js condenses ~330 dots into the mark, turned −90° and at 96 px, on the greeting's row;
//  - hands over through window.__waviBoot.claim (app-shell/boot.ts): to the welcome page, which turns that mark upright
//    and slides it home (app-shell/mark-entrance.ts), or 'away' when a session is shown, where the dots scatter outward.
// The dots live in a worker on an OffscreenCanvas: they cost the main thread nothing while it runs the bundle (DOM dots
// pushed the first interactive frame back by tens of ms).
;(() => {
  const THEME_KEY = 'tr.theme.boot'
  const LAYOUT_KEY = 'tr.boot.layout'
  /** The last dot lands: up to 300 ms late, 800 ms each (boot-worker.js). */
  const FORMED = 1100
  /** The dotted mark's size (px); the welcome page's mark rests at 36. */
  const MARK = 96

  const read = (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  const pref = read(THEME_KEY)
  const light = pref === 'light' || (pref !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = light ? 'light' : 'dark'

  let layout = null
  try {
    layout = JSON.parse(read(LAYOUT_KEY) ?? 'null')
  } catch {
    layout = null
  }
  const valid = layout && ['left', 'top', 'right', 'bottom', 'anchorY'].every((k) => Number.isFinite(layout[k]))
  // Without a mirror: the default sidebar (264), the header (44) and the card gap (6).
  const inset = valid ? layout : { left: 264, top: 44, right: 6, bottom: 6 }
  const card = { left: inset.left, top: inset.top, right: innerWidth - inset.right, bottom: innerHeight - inset.bottom }
  let ax = (card.left + card.right) / 2
  let ay = valid ? card.top + layout.anchorY : (card.top + card.bottom) / 2 - 60

  const style = document.createElement('style')
  style.textContent = `
#wavi-boot { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
#wavi-boot .card { position: absolute; border-radius: var(--radius-window); background: var(--bg-app); box-shadow: var(--card-edge), var(--card-shadow); }
#wavi-boot canvas { position: absolute; inset: 0; width: 100%; height: 100%; }`
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = 'wavi-boot'
  el.setAttribute('aria-hidden', 'true')
  const cardEl = document.createElement('div')
  cardEl.className = 'card'
  // Insets, not a size: the window can still change size while this is up (restored to full screen, fitted to the screen).
  cardEl.style.cssText = `left:${inset.left}px;top:${inset.top}px;right:${inset.right}px;bottom:${inset.bottom}px`
  el.appendChild(cardEl)

  let worker = null
  let observer = null
  let onResize = null
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const canvas = document.createElement('canvas')
  if (!reduce && 'transferControlToOffscreen' in canvas) {
    const dpr = devicePixelRatio || 1
    canvas.width = Math.round(innerWidth * dpr)
    canvas.height = Math.round(innerHeight * dpr)
    el.appendChild(canvas)
    const colour = () => getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#808080'
    const offscreen = canvas.transferControlToOffscreen()
    worker = new Worker('./boot-worker.js')
    worker.postMessage({ init: { canvas: offscreen, dpr, card, at: { x: ax, y: ay }, color: colour(), started: performance.timeOrigin + performance.now() } }, [offscreen])
    // The settings can name another theme than the mirror did (first launch): the dots follow.
    observer = new MutationObserver(() => worker.postMessage({ color: colour() }))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    // The canvas keeps its pixels in step with the window, so the dots never stretch.
    onResize = () => worker.postMessage({ size: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 } })
    addEventListener('resize', onResize)
  }
  document.body.appendChild(el)

  const started = performance.now()
  let claimed = false
  /** A 'welcome' claim still waiting for the dots to form. */
  let pending = null
  const scatter = () => {
    worker.postMessage({ scatter: true })
    setTimeout(remove, 450)
  }
  const remove = () => {
    el.remove()
    observer?.disconnect()
    if (onResize) removeEventListener('resize', onResize)
    worker?.terminate()
  }
  const fadeOut = (ms) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }).finished.then(remove, remove)

  /**
   * React takes over. 'welcome': the dots finish forming at `anchor` (viewport px), fade, and the promise resolves with
   * the mark's pose for the welcome page to carry on from. 'away': the dots scatter outward. Null when there is nothing
   * to hand over (claimed already, or reduced motion). 'away' while a 'welcome' claim waits (the welcome page went away
   * first) scatters the dots and gives that claim null.
   */
  function claim(target, anchor) {
    if (pending && target === 'away') {
      clearTimeout(pending.timer)
      pending.resolve(null)
      pending = null
      scatter()
      return Promise.resolve(null)
    }
    if (claimed) return Promise.resolve(null)
    claimed = true
    clearTimeout(giveUp)
    // React's own card is in place by now.
    cardEl.remove()
    if (!worker || target !== 'welcome') {
      if (worker) scatter()
      else fadeOut(160)
      return Promise.resolve(null)
    }
    if (anchor) {
      ax = anchor.x
      ay = anchor.y
      worker.postMessage({ anchor })
    }
    const wait = Math.max(0, started + FORMED - performance.now())
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending = null
        fadeOut(220)
        resolve({ x: ax, y: ay, size: MARK, angle: -90 })
      }, wait)
      pending = { timer, resolve }
    })
  }

  // Nothing took over (the page failed to start): don't leave the dots up.
  const giveUp = setTimeout(() => claim('away'), 8000)
  window.__waviBoot = { claim }
})()
