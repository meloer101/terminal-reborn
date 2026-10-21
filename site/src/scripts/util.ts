/* Small helpers shared by every module. */

export type Status = 'running' | 'needs_you' | 'done_unread' | 'error' | 'idle'

export const root = document.documentElement

export function $<T extends Element = HTMLElement>(sel: string, el: ParentNode = document): T | null {
  return el.querySelector<T>(sel)
}
export function $$<T extends Element = HTMLElement>(sel: string, el: ParentNode = document): T[] {
  return Array.from(el.querySelectorAll<T>(sel))
}
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}
const SVG_NS = 'http://www.w3.org/2000/svg'
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}
export const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const glyph = (status: Status): string => `<svg viewBox="0 0 14 14" aria-hidden="true"><use href="#g-${status}"/></svg>`

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const rand = (a: number, b: number): number => a + Math.random() * (b - a)
export function pick<T>(list: readonly T[]): T {
  return list[(Math.random() * list.length) | 0] as T
}
export const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)')
export const reduced = (): boolean => reduceMq.matches
export const fineMq = window.matchMedia('(hover: hover) and (pointer: fine)')
export const narrowMq = window.matchMedia('(max-width: 900px)')
export const dpr = (max = 2): number => Math.min(window.devicePixelRatio || 1, max)

/** Calls `cb(true|false)` as the element enters or leaves the viewport (with a margin). */
export function watch(el: Element | null, cb: (on: boolean) => void, rootMargin = '80px'): () => void {
  if (!el) return () => {}
  if (!('IntersectionObserver' in window)) {
    cb(true)
    return () => {}
  }
  const io = new IntersectionObserver(([e]) => cb(!!e?.isIntersecting), { rootMargin })
  io.observe(el)
  return () => io.disconnect()
}

export interface Loop {
  start(): void
  stop(): void
  readonly on: boolean
}
/** A requestAnimationFrame loop; `fn(now, dt)` gets milliseconds and can return false to stop itself. */
export function loop(fn: (now: number, dt: number) => boolean | void): Loop {
  let id = 0
  let on = false
  let last = 0
  const tick = (now: number): void => {
    if (!on) return
    const dt = Math.min(64, now - (last || now - 16))
    last = now
    if (fn(now, dt) === false) {
      on = false
      return
    }
    id = requestAnimationFrame(tick)
  }
  return {
    start() {
      if (on) return
      on = true
      last = 0
      id = requestAnimationFrame(tick)
    },
    stop() {
      on = false
      cancelAnimationFrame(id)
    },
    get on() {
      return on
    }
  }
}

/** Waits for a webfont (CSS font shorthand) without hanging if the API is missing or slow. */
export function fontReady(spec: string): Promise<void> {
  if (!document.fonts || !document.fonts.load) return Promise.resolve()
  return Promise.race([
    document.fonts.load(spec).then(() => undefined, () => undefined),
    new Promise<void>((r) => setTimeout(r, 2500))
  ])
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** True while the user is typing into a field, so single-key shortcuts stay out of the way. */
export function typing(e: Event): boolean {
  const t = e.target
  return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
}
