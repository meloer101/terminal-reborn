// The simulator's screen in the iOS 模拟器 view (Figma 76C): frames from main's MessagePort drawn on a canvas, fitted,
// centred and rounded like the device; pointer, wheel and keys on it drive the device.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  displayGeometry,
  fitRect,
  hidUsageForCode,
  HOME_INDICATOR_BAND,
  MAX_SCROLL,
  normalizedPoint,
  rawBottomEdge,
  rawDelta,
  rawPoint,
  SIM_CORNER_RATIO,
  SIM_FRAME_ACK,
  SIM_PORT_MESSAGE,
  type Rect,
  type SimFrameMessage,
  type SimOrientation,
  type Size
} from '@shared/simulator'
import styles from './SimulatorView.module.css'

/** Space kept around the screen inside the view, in CSS px. */
const INSET = 12
/** Aspect of the placeholder before a frame says the real one (iPhone 17 Pro). */
const PLACEHOLDER_SIZE: Size = { width: 1206, height: 2622 }

function insetBox(size: Size): Rect {
  return { x: INSET, y: INSET, width: Math.max(0, size.width - 2 * INSET), height: Math.max(0, size.height - 2 * INSET) }
}

const radiusOf = (rect: Rect) => SIM_CORNER_RATIO * Math.min(rect.width, rect.height)

/** Where the screen was last drawn, for mapping the pointer back to the device. */
interface Drawn {
  rect: Rect
  inputOrientation: SimOrientation | null
}

export function SimulatorScreen({
  orientation,
  live,
  label,
  placeholder
}: {
  orientation: SimOrientation
  /** Frames are coming: draw them and take input. */
  live: boolean
  label: string
  /** Shown in the rounded placeholder while there is no frame (正在启动, an error). */
  placeholder: ReactNode
}) {
  const wellRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<ImageBitmap | null>(null)
  const drawnRef = useRef<Drawn | null>(null)
  const orientationRef = useRef(orientation)
  const scheduled = useRef(0)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  const draw = () => {
    scheduled.current = 0
    const canvas = canvasRef.current
    const well = wellRef.current
    const frame = frameRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !well || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const width = well.clientWidth
    const height = well.clientHeight
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const geometry = frame ? displayGeometry(frame.width, frame.height, orientationRef.current) : null
    if (!frame || !geometry) {
      drawnRef.current = null
      return
    }
    const rect = fitRect(insetBox({ width, height }), geometry.display)
    drawnRef.current = { rect, inputOrientation: geometry.inputOrientation }
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radiusOf(rect))
    ctx.clip()
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
    ctx.rotate((geometry.rotation * Math.PI) / 180)
    const sideways = Math.abs(geometry.rotation) === 90
    const w = sideways ? rect.height : rect.width
    const h = sideways ? rect.width : rect.height
    ctx.drawImage(frame, -w / 2, -h / 2, w, h)
    ctx.restore()
  }
  const drawRef = useRef(draw)
  useLayoutEffect(() => {
    drawRef.current = draw
  })
  const requestDraw = () => {
    if (!scheduled.current) scheduled.current = requestAnimationFrame(() => drawRef.current())
  }
  const requestDrawRef = useRef(requestDraw)

  useEffect(() => {
    orientationRef.current = orientation
    requestDrawRef.current()
  }, [orientation])

  // The frame port: main sends a fresh one for every show. Each frame is acknowledged once decoded, so main sends
  // the next (one in flight; it keeps only the newest while waiting).
  useEffect(() => {
    let port: MessagePort | null = null
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data !== SIM_PORT_MESSAGE || !event.ports[0]) return
      port?.close()
      const current = event.ports[0]
      port = current
      current.onmessage = (message: MessageEvent<SimFrameMessage>) => {
        const jpeg = message.data.jpeg as Uint8Array<ArrayBuffer>
        createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
          .then((bitmap) => {
            if (port !== current) return bitmap.close()
            frameRef.current?.close()
            frameRef.current = bitmap
            requestDrawRef.current()
          })
          .catch(() => {})
          .finally(() => current.postMessage(SIM_FRAME_ACK))
      }
      current.start()
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      port?.close()
      port = null
      frameRef.current?.close()
      frameRef.current = null
      if (scheduled.current) cancelAnimationFrame(scheduled.current)
    }
  }, [])

  // A new device or a lost stream: the old picture goes.
  useEffect(() => {
    if (live) return
    frameRef.current?.close()
    frameRef.current = null
    requestDrawRef.current()
  }, [live])

  useEffect(() => {
    const well = wellRef.current
    if (!well) return
    const observer = new ResizeObserver(() => {
      setSize({ width: well.clientWidth, height: well.clientHeight })
      requestDrawRef.current()
    })
    observer.observe(well)
    return () => observer.disconnect()
  }, [])

  useInput(canvasRef, drawnRef, live)

  const placeholderRect = live ? null : fitRect(insetBox(size), PLACEHOLDER_SIZE)
  return (
    <div ref={wellRef} className={styles.well}>
      <canvas ref={canvasRef} className={styles.canvas} tabIndex={live ? 0 : -1} aria-label={label} role="img" data-testid="simulator-screen" />
      {placeholderRect && placeholderRect.width > 0 && (
        <div
          className={styles.placeholder}
          style={{
            left: placeholderRect.x,
            top: placeholderRect.y,
            width: placeholderRect.width,
            height: placeholderRect.height,
            borderRadius: radiusOf(placeholderRect)
          }}
        >
          {placeholder}
        </div>
      )}
    </div>
  )
}

/** Pointer → touches, wheel → scroll, keys (while the canvas has focus) → HID keys; ⌘ combinations stay the app's. */
function useInput(canvasRef: RefObject<HTMLCanvasElement | null>, drawnRef: RefObject<Drawn | null>, live: boolean): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !live) return
    const sim = window.tr.simulator
    let edge = 0
    let down = false
    /** The last point sent, in device coordinates: a touch cut short ends there. */
    let last = { x: 0, y: 0 }

    const local = (event: PointerEvent | WheelEvent) => {
      const box = canvas.getBoundingClientRect()
      return { x: event.clientX - box.left, y: event.clientY - box.top }
    }
    const touch = (phase: 'begin' | 'move' | 'end', event: PointerEvent) => {
      const drawn = drawnRef.current
      if (!drawn) return false
      const point = normalizedPoint(local(event), drawn.rect, phase !== 'begin')
      if (!point) return false
      if (phase === 'begin') edge = point.y >= HOME_INDICATOR_BAND ? rawBottomEdge(drawn.inputOrientation) : 0
      last = rawPoint(drawn.inputOrientation, point.x, point.y)
      sim.touch({ phase, x: last.x, y: last.y, edge })
      return true
    }
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      canvas.focus({ preventScroll: true })
      if (!touch('begin', event)) return
      down = true
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    const onMove = (event: PointerEvent) => {
      if (down) touch('move', event)
    }
    const onUp = (event: PointerEvent) => {
      if (!down) return
      down = false
      touch('end', event)
    }
    const onWheel = (event: WheelEvent) => {
      const drawn = drawnRef.current
      if (!drawn) return
      const at = normalizedPoint(local(event), drawn.rect)
      if (!at) return
      event.preventDefault()
      const clamp = (v: number) => Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, v))
      const line = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
      const delta = rawDelta(drawn.inputOrientation, clamp((event.deltaX * line) / drawn.rect.width), clamp((event.deltaY * line) / drawn.rect.height))
      const anchor = rawPoint(drawn.inputOrientation, at.x, at.y)
      sim.scroll({ dx: delta.dx, dy: delta.dy, x: anchor.x, y: anchor.y })
    }
    // Keys sent down: each gets exactly one up, even when ⌘ is held at its release or the canvas loses the keyboard.
    const pressed = new Set<number>()
    const onKey = (event: KeyboardEvent) => {
      const usage = hidUsageForCode(event.code)
      if (usage === null) return
      if (event.type === 'keydown') {
        // ⌘ shortcuts stay the Mac's.
        if (event.metaKey || event.repeat || pressed.has(usage)) return
        pressed.add(usage)
        sim.key('down', usage)
      } else if (pressed.delete(usage)) sim.key('up', usage)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    const releaseAll = () => {
      for (const usage of pressed) sim.key('up', usage)
      pressed.clear()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('keydown', onKey)
    canvas.addEventListener('keyup', onKey)
    canvas.addEventListener('blur', releaseAll)
    return () => {
      releaseAll()
      // The view went mid-drag (hidden, another device, the stream lost): the finger lifts where it was.
      if (down) sim.touch({ phase: 'end', x: last.x, y: last.y, edge })
      canvas.removeEventListener('blur', releaseAll)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKey)
      canvas.removeEventListener('keyup', onKey)
    }
  }, [canvasRef, drawnRef, live])
}
