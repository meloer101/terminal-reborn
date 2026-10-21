/* The hero's row of question marks on an old TV: a WebGL tube (scanlines, aperture grille, colour misconvergence,
   unstable sync, a tracking band, snow, dropouts, hum bar, vertical roll, warm-up and switch-off).
   Ten "?" are ten agents waiting; answering one turns it into "·"; all ten answered shows ALL RUNNING / 全部在跑. */
import { gsap } from 'gsap'
import { ALL_RUNNING } from './data'
import { dpr, rand, reduced } from './util'

const VERT = `attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}`

const FRAG = `
precision mediump float;
varying vec2 v;
uniform sampler2D tex;
uniform vec2 res;
uniform float time;
uniform float power;
uniform float glitch;
uniform float snow;
uniform float roll;
uniform vec2 mouse;
uniform float hover;

float h1(float n) { return fract(sin(n) * 43758.5453123); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float n1(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
vec3 tap(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(tex, uv).rgb;
}

void main() {
  // Tube power: a dot widens into a line, the line opens into the picture.
  float pw = clamp(power, 0.0, 1.0);
  float sx = clamp(pw * 4.0, 0.0, 1.0);
  float sy = max(clamp((pw - 0.25) / 0.75, 0.0, 1.0), 0.004);
  vec2 q = v - 0.5;
  if (abs(q.x) > sx * 0.5 + 0.001 || abs(q.y) > sy * 0.5 + 0.004) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 uv = vec2(q.x / max(sx, 0.001), q.y / sy) + 0.5;
  float t = time;

  // Vertical hold slipping.
  uv.y = fract(uv.y + roll);

  // Horizontal sync: per-line jitter, a slow wave, a travelling tracking band and random tears.
  float row = floor(uv.y * res.y / 3.0);
  float j = (h2(vec2(row, floor(t * 24.0))) - 0.5) * 0.0018;
  j += sin(uv.y * 40.0 + t * 3.0) * 0.0006 + sin(uv.y * 7.0 - t * 1.3) * 0.0012;
  float by = 1.0 - fract(t * 0.11);
  float band = smoothstep(0.07, 0.0, abs(uv.y - by));
  j += band * (n1(uv.y * 160.0 + t * 40.0) - 0.5) * 0.05;
  float seg = floor(uv.y * 18.0);
  float k = floor(t * 9.0);
  float tear = step(0.965 - glitch * 0.35, h2(vec2(seg, k)));
  j += tear * (h2(vec2(seg + 7.0, k)) - 0.5) * (0.04 + glitch * 0.3);

  // The pointer bends the picture around it.
  vec2 dm = (v - mouse) * vec2(res.x / res.y, 1.0);
  float near = hover * exp(-dot(dm, dm) * 9.0);
  j += near * sin(uv.y * 90.0 + t * 22.0) * 0.012;
  uv.x += j;

  // Misconverged guns, a soft glow and a ghost echo.
  float ca = 0.0025 + glitch * 0.02 + near * 0.014 + band * 0.01 + 0.0015 * sin(t * 0.9);
  vec3 c;
  c.r = tap(uv + vec2(ca, 0.0)).r;
  c.g = tap(uv).g;
  c.b = tap(uv - vec2(ca, 0.0)).b;
  vec3 g = (tap(uv + vec2(0.005, 0.0)) + tap(uv - vec2(0.005, 0.0)) + tap(uv + vec2(0.0, 0.04)) + tap(uv - vec2(0.0, 0.04))) * 0.25;
  c += g * 0.45;
  c += tap(uv - vec2(0.02, 0.0)) * vec3(0.10, 0.16, 0.26);

  // Scanlines, aperture grille, hum bar, flicker.
  float sl = 0.58 + 0.42 * pow(abs(sin(gl_FragCoord.y * 3.14159 / 3.0)), 2.0);
  c *= sl;
  float m = mod(gl_FragCoord.x, 3.0);
  c *= vec3(m < 1.0 ? 1.15 : 0.82, (m >= 1.0 && m < 2.0) ? 1.15 : 0.82, m >= 2.0 ? 1.15 : 0.82);
  c *= 0.9 + 0.14 * sin((v.y - t * 0.18) * 6.2832);
  c *= 0.9 + 0.12 * h1(floor(t * 30.0));

  // Snow and dropouts.
  float sn = h2(gl_FragCoord.xy * 0.5 + vec2(t * 97.0, t * 57.0));
  float base = 0.04 + snow * 0.8 + band * 0.14 + glitch * 0.25;
  c += vec3(step(1.0 - base * 0.32, sn)) * (0.22 + snow * 0.6);
  c += (sn - 0.5) * base * 0.22;
  float dr = step(0.9975 - snow * 0.03, h2(vec2(floor(gl_FragCoord.y / 2.0), floor(t * 14.0))));
  c += dr * 0.45;

  // The bright line while the tube warms up.
  float warm = 1.0 - smoothstep(0.25, 0.7, pw);
  c += vec3(0.85, 0.92, 1.0) * warm * max(0.0, 1.4 - abs(q.y) / max(sy * 0.5, 0.001) * 1.2);

  // Fade the edges so the canvas has no border over the page (it is screen-blended).
  float ex = smoothstep(0.0, 0.08, v.x) * smoothstep(1.0, 0.92, v.x);
  float ey = smoothstep(0.0, 0.2, v.y) * smoothstep(1.0, 0.8, v.y);
  c *= ex * ey;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`

type UniformName = 'res' | 'time' | 'power' | 'glitch' | 'snow' | 'roll' | 'mouse' | 'hover'
const COUNT = 10
const fresh = (): string[] => Array.from({ length: COUNT }, () => '?')
const GROTESK = '"Wavi Archivo", "Archivo", "Helvetica Neue", Arial, sans-serif'

export class CRT {
  canvas: HTMLCanvasElement
  chars = fresh()
  done = false
  power = 0
  /** The scroll's share of the tube power (1 at the top of the page, 0 once the hero has scrolled away).
      Kept apart from `power` so the intro and the scroll never fight over one value. */
  scrollPower = 1
  glitch = 0
  snow = 0
  roll = 0
  hover = 0
  hoverTarget = 0
  mouse: [number, number] = [-9, -9]
  /** centre of each glyph, in CSS px from the canvas's left edge */
  centers: number[] = []
  onAllAnswered: (() => void) | null = null
  onReset: (() => void) | null = null

  private gl: WebGLRenderingContext | null = null
  private ctx2: CanvasRenderingContext2D | null = null
  private readonly src = document.createElement('canvas')
  private readonly u: Partial<Record<UniformName, WebGLUniformLocation | null>> = {}
  private running = false
  private raf = 0
  private idleTimer = 0
  private readonly t0 = performance.now()
  private cssW = 1
  private cssH = 1

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    if (!this.initGL()) this.use2d()
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.stop()
    })
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.initGL()) {
        this.bake()
        this.start()
      }
    })
    if (reduced()) this.power = 1
  }

  private initGL(): boolean {
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false })
    if (!gl) return false
    const compile = (type: number, code: string): WebGLShader | null => {
      const s = gl.createShader(type)
      if (!s) return null
      gl.shaderSource(s, code)
      gl.compileShader(s)
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
    }
    const vs = compile(gl.VERTEX_SHADER, VERT)
    const fs = compile(gl.FRAGMENT_SHADER, FRAG)
    const prog = gl.createProgram()
    if (!vs || !fs || !prog) return false
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    for (const name of ['res', 'time', 'power', 'glitch', 'snow', 'roll', 'mouse', 'hover'] as const) {
      this.u[name] = gl.getUniformLocation(prog, name)
    }
    this.gl = gl
    return true
  }

  /** WebGL refused: swap in a fresh canvas and draw a simpler 2D version. */
  private use2d(): void {
    const next = document.createElement('canvas')
    next.className = this.canvas.className
    for (const a of ['role', 'aria-label']) {
      const v = this.canvas.getAttribute(a)
      if (v) next.setAttribute(a, v)
    }
    this.canvas.replaceWith(next)
    this.canvas = next
    this.ctx2 = next.getContext('2d')
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    this.cssW = r.width
    this.cssH = r.height
    const k = dpr(1.5)
    this.canvas.width = Math.round(r.width * k)
    this.canvas.height = Math.round(r.height * k)
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.bake()
    if (!this.running) this.draw(performance.now())
  }

  /** Draws the current row (or 全部在跑) into the low-resolution source the tube displays. */
  bake(): void {
    const w = Math.max(8, Math.round(this.canvas.width * 0.5))
    const hh = Math.max(8, Math.round(this.canvas.height * 0.5))
    this.src.width = w
    this.src.height = hh
    const x = this.src.getContext('2d')
    if (!x) return
    x.fillStyle = '#000'
    x.fillRect(0, 0, w, hh)
    x.fillStyle = '#fff'
    x.textBaseline = 'middle'
    x.textAlign = 'center'
    this.centers = []
    if (this.done) {
      const { text, font } = ALL_RUNNING
      x.font = font
      const fs = Math.min(hh * 0.66, ((w * 0.46) / x.measureText(text).width) * 100)
      x.font = font.replace('100px', `${fs}px`)
      x.fillText(text, w / 2, hh * 0.52)
    } else {
      x.font = `800 100px ${GROTESK}`
      x.fontStretch = 'expanded'
      const adv = this.chars.map(() => x.measureText('?').width)
      const gap = 8
      const total = adv.reduce((s, a) => s + a, 0) + gap * (adv.length - 1)
      const fs = Math.min(hh * 0.84, ((w * 0.9) / total) * 100)
      const k = fs / 100
      x.font = `800 ${fs}px ${GROTESK}`
      x.fontStretch = 'expanded'
      let cx = (w - total * k) / 2
      this.chars.forEach((ch, i) => {
        const a = (adv[i] ?? 0) * k
        const mid = cx + a / 2
        x.fillText(ch, mid, hh * 0.53)
        this.centers.push((mid / w) * this.cssW)
        cx += a + gap * k
      })
    }
    const gl = this.gl
    if (gl) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src)
  }

  private uni(name: UniformName, a: number, b?: number): void {
    const gl = this.gl
    const loc = this.u[name]
    if (!gl || !loc) return
    if (b == null) gl.uniform1f(loc, a)
    else gl.uniform2f(loc, a, b)
  }

  private draw(now: number): void {
    const t = reduced() ? 2.4 : (now - this.t0) / 1000
    this.hover += (this.hoverTarget - this.hover) * 0.08
    const gl = this.gl
    if (gl) {
      this.uni('res', this.canvas.width, this.canvas.height)
      this.uni('time', t)
      this.uni('power', this.power * this.scrollPower)
      this.uni('glitch', this.glitch)
      this.uni('snow', this.snow)
      this.uni('roll', this.roll)
      this.uni('mouse', this.mouse[0], this.mouse[1])
      this.uni('hover', this.hover)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      return
    }
    const c = this.ctx2
    if (!c) return
    const W = this.canvas.width
    const H = this.canvas.height
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = '#000'
    c.fillRect(0, 0, W, H)
    if (this.power * this.scrollPower <= 0.05) return
    const jit = reduced() ? 0 : (Math.random() - 0.5) * W * (0.003 + this.glitch * 0.03)
    c.globalAlpha = 0.9
    c.drawImage(this.src, jit, 0, W, H)
    c.globalAlpha = 1
    c.fillStyle = 'rgba(0,0,0,0.35)'
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1)
  }

  start(): void {
    if (reduced()) {
      this.draw(performance.now())
      return
    }
    if (this.running) return
    this.running = true
    const tick = (now: number): void => {
      if (!this.running) return
      this.draw(now)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
    this.scheduleIdle()
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    clearTimeout(this.idleTimer)
  }

  /** Random hiccups between answers: a tear, a burst of snow, a rolling picture, a brownout. */
  private scheduleIdle(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = window.setTimeout(() => {
      if (!this.running) return
      const r = Math.random()
      if (r < 0.42) gsap.fromTo(this, { glitch: 0.75 }, { glitch: 0, duration: 0.45, ease: 'power2.out' })
      else if (r < 0.68) gsap.fromTo(this, { snow: 0.7 }, { snow: 0, duration: 0.32, ease: 'power1.out' })
      else if (r < 0.88) {
        gsap.to(this, { roll: '+=1', duration: 0.75, ease: 'power3.inOut', onComplete: () => { this.roll %= 1 } })
        gsap.fromTo(this, { glitch: 0.45 }, { glitch: 0, duration: 0.9 })
      } else if (this.power >= 0.999) {
        gsap.timeline().to(this, { power: 0.62, duration: 0.07 }).to(this, { power: 1, duration: 0.3, ease: 'power2.out' })
      }
      this.scheduleIdle()
    }, rand(2600, 6500))
  }

  powerOn(duration = 1.15): gsap.core.Tween {
    return gsap.fromTo(this, { power: 0 }, { power: 1, duration, ease: 'power2.inOut' })
  }

  /** Short channel-change noise; used by the page's easter egg and section glitches. */
  shock(amount = 1): void {
    gsap.fromTo(this, { glitch: amount, snow: amount * 0.9 }, { glitch: 0, snow: 0, duration: 0.9, ease: 'power2.out' })
    gsap.to(this, { roll: '+=1', duration: 0.5, ease: 'power3.inOut', onComplete: () => { this.roll %= 1 } })
  }

  setPointer(x: number, y: number): void {
    this.mouse = [x / this.cssW, 1 - y / this.cssH]
    this.hoverTarget = 1
  }

  clearPointer(): void {
    this.hoverTarget = 0
  }

  /** Index of the open "?" closest to x (CSS px from the canvas's left edge), or -1. */
  nearest(x: number): number {
    let best = -1
    let d = Infinity
    this.chars.forEach((ch, i) => {
      const c = this.centers[i]
      if (ch !== '?' || c == null) return
      const dd = Math.abs(c - x)
      if (dd < d) {
        d = dd
        best = i
      }
    })
    return best
  }

  /** Answers one waiting agent: the "?" at `index` (or a random one) flips to "·" through a channel change. */
  answer(index?: number): number {
    if (this.done) return -1
    const open = this.chars.map((c, i) => (c === '?' ? i : -1)).filter((i) => i >= 0)
    if (!open.length) return -1
    const idx = index != null && this.chars[index] === '?' ? index : (open[(Math.random() * open.length) | 0] ?? 0)
    if (reduced()) {
      this.chars[idx] = '·'
      this.bake()
      this.draw(performance.now())
    } else {
      gsap
        .timeline()
        .to(this, { glitch: 1, snow: 0.85, duration: 0.05 })
        .to(this, { roll: '+=1', duration: 0.42, ease: 'power3.inOut', onComplete: () => { this.roll %= 1 } }, 0)
        .add(() => {
          this.chars[idx] = '·'
          this.bake()
        }, 0.2)
        .to(this, { glitch: 0, snow: 0, duration: 0.7, ease: 'power2.out' }, 0.24)
    }
    if (open.length === 1) this.finish()
    return idx
  }

  private finish(): void {
    window.setTimeout(() => {
      this.done = true
      this.bake()
      if (!reduced()) gsap.fromTo(this, { glitch: 0.9, snow: 0.5 }, { glitch: 0, snow: 0, duration: 0.8 })
      else this.draw(performance.now())
      this.onAllAnswered?.()
    }, 650)
    window.setTimeout(() => {
      const reset = (): void => {
        this.done = false
        this.chars = fresh()
        this.bake()
        this.onReset?.()
      }
      if (reduced()) {
        reset()
        this.draw(performance.now())
        return
      }
      gsap
        .timeline()
        .to(this, { power: 0, duration: 0.5, ease: 'power2.in' })
        .add(reset)
        .to(this, { power: 1, duration: 1, ease: 'power2.inOut' })
    }, 3800)
  }
}
