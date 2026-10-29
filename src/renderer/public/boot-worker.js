// The boot screen's dots (boot.js, PRD F18 · Figma 39I/39J): drawn on an OffscreenCanvas in this worker, so neither
// setting them up nor any frame touches the main thread while it parses and runs the app bundle.
// Messages: { init } once, then { anchor } (where the mark forms, viewport px), { color } (the theme changed),
// { size } (the window was resized) and { scatter } (a session is shown).

/** Points inside the mark's outline (build/icon.svg, viewBox units around its centre), on a staggered 24-unit grid. */
const POINTS = [
    83, -317, 107, -316, 128, -314, 150, -316, 179, -316, 203, -320, 47, -291, 69, -291, 95, -291, 114, -290, 144, -293, 164, -289,
    188, -290, 212, -294, 238, -294, 11, -267, 35, -267, 54, -268, 80, -264, 103, -268, 130, -268, 178, -264, 198, -270, 226, -269,
    250, -267, -7, -247, 21, -241, 43, -243, 70, -245, 212, -248, 239, -242, 257, -242, -40, -221, -18, -218, 10, -219, 34, -221,
    201, -222, 224, -223, 246, -217, -221, -198, -197, -194, -176, -199, -146, -194, -123, -192, -55, -197, -28, -200, -6, -199, 17, -199,
    209, -200, 238, -197, 260, -196, -284, -174, -254, -176, -230, -170, -207, -175, -187, -171, -160, -173, -135, -172, -109, -168, -87, -172,
    -64, -168, -41, -168, -12, -171, 198, -170, 226, -174, 247, -169, -313, -144, -293, -144, -270, -150, -244, -144, -222, -148, -197, -147,
    -173, -151, -149, -147, -125, -146, -103, -148, -56, -147, -31, -148, 22, -151, 43, -148, 208, -148, 238, -150, 259, -151, -306, -127,
    -279, -123, -259, -123, -88, -126, -63, -122, -38, -124, 8, -127, 28, -127, 59, -125, 76, -120, 204, -123, 227, -121, 245, -125,
    -316, -103, -292, -99, -271, -103, -103, -99, -76, -101, -54, -101, -5, -101, 21, -96, 43, -99, 68, -100, 89, -102, 117, -103,
    184, -100, 209, -103, 237, -102, -331, -77, -304, -73, -283, -78, -109, -76, -92, -77, -64, -77, -38, -75, 33, -78, 53, -76,
    79, -74, 100, -76, 126, -78, 151, -77, 203, -79, 226, -73, -315, -49, -291, -55, -272, -55, -125, -48, -102, -50, -78, -51,
    -53, -48, 88, -51, 115, -55, 143, -50, 166, -50, 187, -51, 234, -51, -301, -27, -276, -31, -254, -25, -134, -30, -114, -30,
    -89, -28, -65, -31, 107, -31, 128, -29, 153, -30, 177, -28, 200, -25, -293, -6, -265, -3, -246, -4, -224, -6, -149, -7,
    -128, -7, -101, -2, -75, -5, 140, -6, 165, -7, 185, -4, 214, -8, 240, -2, -279, 16, -259, 21, -232, 22, -208, 22,
    -139, 18, -111, 16, -92, 22, 125, 20, 179, 19, 204, 19, 223, 18, 246, 22, 273, 23, -245, 45, -222, 46, -198, 41,
    -176, 43, -123, 42, -101, 42, 116, 45, 139, 41, 164, 46, 211, 46, 236, 40, 256, 41, 284, 43, -230, 68, -205, 67,
    -185, 70, -161, 66, -135, 67, 82, 72, 105, 65, 131, 65, 155, 71, 224, 67, 248, 66, 272, 65, 295, 69, -194, 89,
    -174, 93, -152, 95, -123, 92, -99, 94, -79, 92, 67, 93, 89, 95, 114, 89, 140, 95, 263, 96, 283, 93, 307, 91,
    -208, 113, -139, 118, -110, 112, -90, 120, -65, 117, -43, 113, 54, 119, 81, 115, 100, 112, 131, 115, 271, 118, 294, 118,
    321, 116, -218, 143, -194, 140, -171, 144, -104, 142, -74, 142, -55, 143, -24, 141, -3, 136, 45, 143, 65, 141, 93, 142,
    115, 141, 264, 136, 286, 144, 307, 143, 334, 141, -210, 166, -181, 165, -162, 165, -85, 161, -66, 168, -43, 166, -20, 167,
    29, 165, 60, 165, 80, 165, 269, 160, 299, 161, 321, 162, -223, 186, -196, 187, -172, 188, -27, 185, 23, 191, 47, 186,
    65, 192, 112, 185, 142, 185, 166, 190, 190, 184, 211, 187, 237, 186, 260, 184, 281, 184, 310, 184, -204, 211, -185, 212,
    11, 214, 34, 211, 56, 215, 104, 213, 125, 214, 156, 214, 177, 214, 200, 208, 227, 216, 245, 216, 273, 215, 294, 213,
    -221, 239, -195, 235, -176, 240, -30, 236, -6, 235, 17, 235, 45, 235, 141, 235, 164, 240, 188, 238, 210, 239, 238, 234,
    -209, 259, -188, 258, -161, 260, -86, 262, -63, 262, -39, 260, -17, 261, 12, 260, 33, 263, -198, 284, -172, 284, -144, 284,
    -121, 284, -102, 284, -72, 286, -52, 285, -29, 287, -7, 282, -182, 308, -159, 309, -139, 305, -116, 307, -89, 311, -61, 307,
    -40, 311, -150, 334, -128, 335, -99, 336
]
/** The dotted mark's size (px). */
const MARK = 96
const MOVE = 800
const LATEST = 300
const ANCHOR_MOVE = 360
const SCATTER = 450

let ctx = null
let colour = '#fff'
let dots = []
let from = null
let anchor = null
let anchorAt = 0
let scatterAt = 0

const now = () => performance.timeOrigin + performance.now()
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const clamp = (t) => Math.min(1, Math.max(0, t))
const rand = (a, b) => a + Math.random() * (b - a)

onmessage = ({ data }) => {
  if (data.init) {
    const { canvas, dpr, card, at, color, started } = data.init
    ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    colour = color
    from = anchor = at
    const sc = MARK / 680
    for (let i = 0; i < POINTS.length; i += 2) {
      dots.push({
        // Turned −90°: (x, y) → (y, −x); relative to the anchor.
        tx: POINTS[i + 1] * sc,
        ty: -POINTS[i] * sc,
        x0: rand(card.left + 16, card.right - 16),
        y0: rand(card.top + 16, card.bottom - 16),
        delay: started + rand(0, LATEST),
        phase: rand(0, Math.PI * 2),
        period: rand(500, 1100)
      })
    }
    requestAnimationFrame(frame)
  }
  if (data.anchor) {
    from = current()
    anchor = data.anchor
    anchorAt = now()
  }
  if (data.scatter) scatterAt = now()
  if (data.color) colour = data.color
  if (data.size) {
    const { width, height, dpr } = data.size
    ctx.canvas.width = Math.round(width * dpr)
    ctx.canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}

function current() {
  if (!anchorAt) return anchor
  const p = easeOut(clamp((now() - anchorAt) / ANCHOR_MOVE))
  return { x: from.x + (anchor.x - from.x) * p, y: from.y + (anchor.y - from.y) * p }
}

function frame() {
  const t = now()
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  const a = current()
  const out = scatterAt ? clamp((t - scatterAt) / SCATTER) : 0
  const spread = 1 + 1.2 * easeOut(out)
  ctx.fillStyle = colour
  const fading = []
  ctx.beginPath()
  for (const d of dots) {
    const l = (t - d.delay) / MOVE
    if (l <= 0) continue
    if (l < 0.15) {
      fading.push(d, l / 0.15)
      continue
    }
    const p = easeOut(clamp((l - 0.15) / 0.85))
    // Once formed, each dot trembles in place (±1.6 px).
    const j = p >= 1 ? 1.6 * Math.sin((t / d.period) * Math.PI * 2 + d.phase) : 0
    const x = d.x0 + (a.x + d.tx * spread - d.x0) * p + j
    const y = d.y0 + (a.y + d.ty * spread - d.y0) * p + j * Math.cos(d.phase)
    ctx.moveTo(x + 1.5, y)
    ctx.arc(x, y, 1.5, 0, Math.PI * 2)
  }
  ctx.globalAlpha = 1 - out
  ctx.fill()
  // Dots still fading in where they start, one by one.
  for (let i = 0; i < fading.length; i += 2) {
    const d = fading[i]
    ctx.globalAlpha = fading[i + 1] * (1 - out)
    ctx.beginPath()
    ctx.arc(d.x0, d.y0, 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
  requestAnimationFrame(frame)
}
