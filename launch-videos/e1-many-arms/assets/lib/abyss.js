/* Film E1's one material: the Old One in black water, as a seekable renderer.
   The creature is drawn procedurally into three canvases every frame: a normal buffer (R = position across the
   tube, G/B = the tube's screen-space side vector, A = coverage), a material buffer (R = cavity, G = terminal
   light, B = depth) and an eye layer in colour. One WebGL pass lights the flesh from them (key light from the
   surface, the terminal lines' own light, subsurface rim, wet speculars, caustics), and adds the water, the depth
   haze, the blood and the marine snow. Nothing keeps a clock: render(t) draws film time t, so seeking always
   gives the same frame. */
(function () {
  const W = 1920;
  const H = 1080;
  const CX = W / 2;
  const CY = H / 2;
  const F0 = 1100;
  const TAU = Math.PI * 2;

  /* ---- Pure helpers ---- */
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ramp = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (k) => k * k * (3 - 2 * k);
  const inOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
  const p3in = (k) => k * k * k;
  const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const mod = (a, n) => ((a % n) + n) % n;

  /* ---- The film's clock (film seconds; bar 3.2 s, beat 0.8 s at 75 BPM) ---- */
  const K = {
    sprout: [-99, 6.4, 7.2, 8.0, 8.8, 9.6, 10.4, 11.2],
    freeze0: 13.6, freeze1: 14.4, eye: 16.0, blood0: 16.5, cmdJ: 22.4, diveIn: 23.2, answer: 24.0,
    out0: 25.0, shut: 25.6, merge0: 28.8, rise: 32.0, couplet: 35.2, flood0: 41.6, line0: 44.25, end: 44.8
  };
  const MERGE = (i) => K.merge0 + [5, 0, 1, 2, 3, 4, 6, 7][i] * 0.4;

  /* ---- The terminals: rebuilt Claude Code / Codex output from film A ---- */
  const FEEDS = {
    cookie: ['> Move the session token into an httpOnly cookie', ' ', '⏺Read(src/middleware.ts)', '⎿Read 88 lines',
      '⏺Update(prisma/schema.prisma)', '⎿Added model Session', '⏺Update(src/middleware.ts)', '⎿Moved the token to an httpOnly cookie',
      '⏺Update(src/auth/session.ts)', '⎿Reads the cookie instead of the header', '⏺The Session table needs a migration first.', ' '],
    cookieAfter: ['⏺Bash(pnpm prisma migrate dev)', '⎿Applied migration 20261022_add_session', '⏺Bash(pnpm test auth)', '⎿24 passed (1.8s)', ' ',
      '⏺Done. The session token now lives in an', 'httpOnly cookie; refresh reads it there.', ' '],
    checkout: ['⏺Read(src/checkout/page.tsx)', '⎿Read 214 lines', '⏺Update(lib/price.ts)', '⎿Updated lib/price.ts with 6 additions', ' ',
      '⏺Bash(pnpm test checkout)', '⎿38 passed (2.1s)', '✻Measuring first paint…', '⏺Read(components/CartSummary.tsx)', '⎿Read 96 lines',
      '⏺Update(components/CartSummary.tsx)', '⎿Memoized cart totals per render', ' ', '⏺Bash(pnpm build)', '⎿Compiled in 8.4s'],
    webhook: ['•Explored', '└ Read webhooks/stripe.ts, lib/retry.ts', '•Edited lib/retry.ts (+19 -2)', ' ', '•Ran pnpm vitest webhook', '└ 12 passed',
      '•Working (34s • esc to interrupt)', '•Explored', '└ Read webhooks/queue.ts', '•Edited webhooks/queue.ts (+8 -1)', '•Edited docs/webhooks.md (+6)'],
    graph: ['⏺Update(src/shared/git-graph/lanes.ts)', '⎿Updated with 41 additions', '⏺Bash(pnpm build)', "⎿error TS2322: Type 'Lane | undefined'",
      "⎿error TS2345: Argument of type 'number'", '✻Fixing two type errors…', '⏺Read(src/shared/git-graph/types.ts)', '⎿Read 77 lines', ' '],
    mobile: ['⏺Read(components/Nav.tsx)', '⎿Read 132 lines', '✻Reproducing the iOS bounce…', '⏺Update(components/Nav.tsx)', '⎿Clamp scrollY during iOS bounce',
      '⏺Bash(pnpm test nav)', '⎿9 passed (0.6s)', ' ', '⏺Write(tests/nav-bounce.spec.ts)', '⎿Wrote 48 lines', '⏺Bash(pnpm playwright test nav)', '⎿3 passed'],
    sidebar: ['⏺Search("needsAttention")', '⎿Found 7 files', '⏺Read(src/state/agents.ts)', '⎿Read 312 lines', '✻Thinking…', '⏺Update(src/state/agents.ts)',
      '⎿Added a rollup selector', '⏺Bash(pnpm vitest agents)', '⎿14 passed (0.9s)', ' ', '⏺Bash(pnpm typecheck)', '⎿No errors'],
    docs: ['•Explored', '└ Read docs/search/index.ts', '•Edited docs/search/index.ts (+22 -9)', '•Ran pnpm docs:build', '└ built 312 pages in 6.1s', ' ',
      '•Edited docs/search/worker.ts (+6 -1)', '•Ran pnpm test search', '└ 21 passed', '•Working (51s • esc to interrupt)'],
    vite: ['•Edited vite.config.ts (+11 -6)', '•Ran pnpm install', '└ added 4 packages in 3.2s', '•Ran pnpm build', '└ built in 4.7s', ' ',
      '•Edited package.json (+2 -2)', '•Ran pnpm test', '└ 212 passed', '•Working (12s • esc to interrupt)']
  };

  /* One arm per worktree. phi: direction round the spine (0 = right, -π/2 = toward the camera), e: pitch (+ = down). */
  const ARMS = [
    { name: 'session-cookie', feed: 'cookie', rootY: 170, phi: Math.PI + 0.22, e: 0.42, L: 2535.0, r0: 107.92, A1: 2.75, A2: 1.76, by: -0.6, bp: -0.5, ph: 0.4 },
    { name: 'checkout-perf', feed: 'checkout', rootY: 40, phi: -0.55, e: -0.35, L: 2405.0, r0: 102.24, A1: 3.19, A2: 2.03, by: 0.9, bp: -0.4, ph: 1.7 },
    { name: 'webhook-retry', feed: 'webhook', rootY: 330, phi: 0.35, e: 0.25, L: 2275.0, r0: 99.4, A1: 2.9, A2: 2.16, by: -1.0, bp: 0.6, ph: 2.9 },
    { name: 'graph-layout', feed: 'graph', rootY: -90, phi: 2.55, e: -0.55, L: 2210.0, r0: 96.56, A1: 3.48, A2: 1.62, by: 1.1, bp: -0.3, ph: 4.1 },
    { name: 'mobile-nav', feed: 'mobile', rootY: 470, phi: -1.15, e: 0.62, L: 2470.0, r0: 102.24, A1: 2.61, A2: 2.29, by: 0.7, bp: 0.5, ph: 5.3 },
    { name: 'sidebar-agg', feed: 'sidebar', rootY: -210, phi: -1.95, e: -0.75, L: 2145.0, r0: 93.72, A1: 3.04, A2: 1.89, by: -0.8, bp: -0.6, ph: 0.9 },
    { name: 'docs-search', feed: 'docs', rootY: 610, phi: 1.85, e: 0.45, L: 2340.0, r0: 99.4, A1: 3.33, A2: 1.76, by: 1.2, bp: 0.4, ph: 2.2 },
    { name: 'vite-7', feed: 'vite', rootY: 250, phi: 2.15, e: 0.1, L: 2275.0, r0: 96.56, A1: 2.46, A2: 2.16, by: -0.9, bp: -0.2, ph: 3.6 }
  ];
  const S_EYE = 0.36;
  const HEAD = { y: -2650, r: 540 };
  const SPINE_R = 124;

  /* ---- Time per arm: the waiting one slows, stops, and starts again after the answer ---- */
  function armTau(i, t) {
    if (i !== 0) return t + ARMS[i].ph * 3;
    if (t < K.freeze0) return t;
    if (t < K.freeze1) { const u = (t - K.freeze0) / (K.freeze1 - K.freeze0); return K.freeze0 + 0.8 * u - 0.4 * u * u; }
    const stuck = K.freeze0 + 0.4;
    if (t < K.shut) return stuck;
    const u = t - K.shut;
    return u < 0.8 ? stuck + 0.5 * u * u : stuck + 0.32 + (u - 0.8);
  }
  function growth(i, t) { return i === 0 ? 1 : expoOut(ramp(t, K.sprout[i], K.sprout[i] + 1.6)); }
  function merged(i, t) { return p3in(ramp(t, MERGE(i), MERGE(i) + 0.8)); }
  /** The heart: lub-dub on every beat (75 BPM) until the eye opens; the flesh swells with it. */
  function pulse(t) {
    if (t < 0 || t >= K.eye) return 0;
    const u = t % 0.8;
    return Math.exp(-u / 0.09) + 0.55 * (u > 0.24 ? Math.exp(-(u - 0.24) / 0.09) : 0);
  }
  /** The creature climbs during the rise. */
  function riseY(t) { const k = ramp(t, K.rise, K.end); return -900 * k * k; }

  /** ts: the time the spine sways by (the waiting arm's own clock at its root, so its eye holds still). */
  function spinePoint(y, t, ts) {
    const w = ts == null ? t : ts;
    return [34 * Math.sin(y / 700 + 0.4 * w), y + riseY(t), 24 * Math.sin(y / 900 + 0.3 * w + 1.3)];
  }

  /** The arm's centreline, radii and arc fractions at film time t (null while it has not sprouted or has merged). */
  function armGeom(i, t) {
    const a = ARMS[i];
    const g = growth(i, t);
    const m = merged(i, t);
    const len = a.L * g * (1 - m);
    if (len < 6) return null;
    const tau = armTau(i, t);
    const N = 110;
    const root = spinePoint(a.rootY, t, i === 0 ? tau : t);
    let yaw = a.phi + 0.22 * Math.sin(0.31 * tau + a.ph) + m * 0.8;
    let pitch = a.e + 0.15 * Math.sin(0.27 * tau + a.ph * 1.7);
    const p = [root[0] + Math.cos(a.phi) * SPINE_R * 0.7, root[1], root[2] + Math.sin(a.phi) * SPINE_R * 0.7];
    const wob = 1 + 0.9 * (1 - g) * Math.sin(t * 7 + a.ph);
    const amp = wob * (1 + 1.5 * m);
    const trem = i === 0 && t >= K.freeze1 && t < K.shut ? 0.02 * Math.sin(t * 23) : 0;
    const pts = []; const rad = []; const ss = [];
    for (let k = 0; k <= N; k++) {
      const s = k / N;
      pts.push([p[0], p[1], p[2]]);
      rad.push(a.r0 * (0.4 + 0.6 * g) * (1 - 0.93 * Math.pow(s, 0.85)) * (1 - 0.3 * m) * (1 + 0.035 * pulse(t - s * 0.25)));
      ss.push(s);
      const env = 0.25 + 1.25 * s;
      const ky = a.A1 * amp * Math.sin(TAU * (0.9 * s - 0.21 * tau) + a.ph) * env + a.by * s + (4.2 + 9 * m) * s * s * s * Math.sign(a.by || 1) + trem;
      const kp = a.A2 * amp * Math.sin(TAU * (0.7 * s - 0.16 * tau) + a.ph * 2.1) * env + a.bp * s;
      yaw += ky / N;
      pitch += kp / N;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      const step = len / N;
      p[0] += Math.cos(pitch) * Math.cos(yaw) * step;
      p[1] += Math.sin(pitch) * step;
      p[2] += Math.cos(pitch) * Math.sin(yaw) * step;
    }
    return { pts, rad, ss, len, g, m, tau };
  }
  function at(geo, s) {
    const n = geo.pts.length - 1;
    const f = Math.max(0, Math.min(n - 1e-6, s * n));
    const k = Math.floor(f); const u = f - k;
    const A = geo.pts[k]; const B = geo.pts[k + 1];
    return { p: [lerp(A[0], B[0], u), lerp(A[1], B[1], u), lerp(A[2], B[2], u)], r: lerp(geo.rad[k], geo.rad[k + 1], u), k, u };
  }

  /* ---- The camera: one take. Keys are film seconds; Catmull-Rom between them. ---- */
  function catmull(p0, p1, p2, p3, u) {
    const u2 = u * u; const u3 = u2 * u;
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  }
  let KEYS = null;
  function buildCamera() {
    const A = at(armGeom(0, 0), 0.44);
    const E = at(armGeom(0, 20), S_EYE);
    const camHook = { x: A.p[0] + 20, y: A.p[1] - 10, z: A.p[2] - 150 };
    // Roll the frame so the hook arm hangs 68° off horizontal, and so the waiting arm lies flat for the eye.
    const rollFor = (geo, s, cam, want) => {
      const P = at(geo, s - 0.01).p; const Q = at(geo, s + 0.01).p;
      const pj = (X) => { const dz = X[2] - cam.z; return [(X[0] - cam.x) / dz, (X[1] - cam.y) / dz]; };
      const a = pj(P); const b = pj(Q);
      let r = want - Math.atan2(b[1] - a[1], b[0] - a[0]);
      while (r > Math.PI / 2) r -= Math.PI;
      while (r < -Math.PI / 2) r += Math.PI;
      return r;
    };
    const rollHook = rollFor(armGeom(0, 0), 0.44, camHook, (72 * Math.PI) / 180);
    const camEye = { x: E.p[0], y: E.p[1], z: E.p[2] - 200 };
    const rollEye = rollFor(armGeom(0, 20), S_EYE, camEye, 0);
    const k = (t, x, y, z, roll) => ({ t, x, y, z, roll });
    KEYS = [
      k(-1.0, camHook.x - 10, camHook.y + 10, camHook.z + 20, rollHook + 0.02),
      k(0.0, camHook.x, camHook.y, camHook.z, rollHook),
      k(1.2, camHook.x + 30, camHook.y + 30, camHook.z - 120, rollHook * 0.85),
      k(3.2, A.p[0] * 0.6 + 40, A.p[1] + 40, A.p[2] - 1000, rollHook * 0.15),
      k(6.4, 150, 360, -1750, 0.04),
      k(9.6, 40, 330, -1950, -0.02),
      k(12.8, -160, 260, -1800, rollEye * 0.3),
      k(14.6, E.p[0] - 40, E.p[1], E.p[2] - 700, rollEye * 0.8),
      k(16.0, E.p[0], E.p[1], E.p[2] - 270, rollEye),
      k(17.6, E.p[0], E.p[1] - 4, E.p[2] - 200, rollEye),
      k(19.2, E.p[0] + 3, E.p[1] - 6, E.p[2] - 178, rollEye),
      k(22.4, E.p[0], E.p[1] - 4, E.p[2] - 155, rollEye),
      k(25.6, E.p[0], E.p[1], E.p[2] - 230, rollEye),
      k(28.8, 0, 320, -2150, 0.02),
      k(32.0, 0, 100, -2400, 0),
      k(33.8, -450, HEAD.y + 1100, -2000, 0),
      k(35.2, -900, HEAD.y + 300, -1700, 0),
      k(41.6, -980, HEAD.y - 560, -1550, 0),
      k(44.8, -700, HEAD.y - 1350, -1350, 0),
      k(46.0, 0, HEAD.y - 1600, -1300, 0)
    ];
    return { E };
  }
  function camAt(t) {
    let i = 1;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i - 1]; const b = KEYS[i]; const c = KEYS[i + 1]; const d = KEYS[Math.min(i + 2, KEYS.length - 1)];
    const u = inOut(clamp01((t - b.t) / (c.t - b.t)));
    const o = {};
    ['x', 'y', 'z', 'roll'].forEach((n) => { o[n] = catmull(a[n], b[n], c[n], d[n], u); });
    // The dive into the eye is a lens move: the focal length grows until the pupil fills the frame.
    const zin = p3in(ramp(t, K.cmdJ, K.diveIn));
    const zout = expoOut(ramp(t, K.out0, K.shut));
    o.zoom = 1 + 15 * (t < K.out0 ? zin : 1 - zout);
    return o;
  }

  /* ---- Sprites for the normal buffer (sphere for the head, cup-and-rim for a sucker) ---- */
  function sprite(size, profile) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const img = x.createImageData(size, size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const dx = (i + 0.5) / size * 2 - 1; const dy = (j + 0.5) / size * 2 - 1;
      const rho = Math.hypot(dx, dy);
      const o = (j * size + i) * 4;
      if (rho >= 1) { img.data[o + 3] = 0; continue; }
      const pr = profile(rho);
      const ux = rho > 1e-4 ? dx / rho : 0; const uy = rho > 1e-4 ? dy / rho : 0;
      // Encoded as the tube is: a = signed tilt along (ux, uy).
      img.data[o] = Math.round((pr.a * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((ux * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((uy * 0.5 + 0.5) * 255);
      img.data[o + 3] = Math.round(pr.alpha * 255);
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  const SPHERE = () => sprite(256, (r) => ({ a: r, alpha: r > 0.985 ? (1 - r) / 0.015 : 1 }));
  const SUCKER = () => sprite(96, (r) => {
    let a;
    if (r < 0.45) a = -0.35 * (r / 0.45);
    else if (r < 0.6) a = lerp(-0.35, 0.45, (r - 0.45) / 0.15);
    else a = lerp(0.45, 0.05, (r - 0.6) / 0.4);
    return { a, alpha: r > 0.8 ? (1 - r) / 0.2 : 1 };
  });

  /* ---- The lighting pass ---- */
  const VERT = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D tG, tM, tE, tS;
uniform vec2 res;
uniform float time, depth, keyI, surf, collapse, inside, snowY, focus, sigil;
uniform vec4 blood0, blood1;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
vec2 tc(vec2 px) { return vec2(px.x / res.x, 1.0 - px.y / res.y); }

vec3 water(vec2 px) {
  float y = px.y / res.y;
  vec3 top = vec3(0.043, 0.102, 0.078);
  vec3 deep = vec3(0.008, 0.024, 0.016);
  vec3 c = mix(mix(top * 1.4, top * 0.55, y), mix(deep * 1.9, deep * 0.45, y), depth);
  // Shafts of light from the surface, gone in the deep.
  float sh = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x0 = res.x * (0.22 + 0.3 * fi) + 140.0 * sin(time * 0.11 + fi * 2.1);
    float d = px.x - x0 - (px.y - res.y * 0.5) * (0.28 - 0.2 * fi);
    float w = 90.0 + 60.0 * fi;
    sh += exp(-d * d / (w * w)) * (0.55 + 0.45 * noise(vec2(px.y * 0.004 - time * 0.25, fi * 7.0)));
  }
  c += vec3(0.81, 0.89, 0.85) * sh * pow(1.0 - y, 1.4) * (1.0 - depth) * 0.13;
  // The surface from below: a bright, rippling ceiling that comes down on the rise.
  float ripple = noise(vec2(px.x * 0.006 + time * 0.3, px.y * 0.02 - time * 0.5)) * 0.5 + noise(vec2(px.x * 0.013 - time * 0.4, px.y * 0.05)) * 0.5;
  float ceil = smoothstep(surf * 1.25 - 0.25, surf * 1.25 - 0.55, y) * surf;
  c = mix(c, vec3(0.70, 0.82, 0.76) * (0.75 + 0.35 * ripple), clamp(ceil, 0.0, 1.0));
  return c;
}

float caustic(vec2 p) {
  vec2 q = p + vec2(fbm(p + time * 0.2), fbm(p - time * 0.17 + 4.0)) * 1.3;
  float n = noise(q * 2.0);
  float a = pow(1.0 - abs(n * 2.0 - 1.0), 8.0);
  n = noise(q * 3.3 + 3.1);
  a += pow(1.0 - abs(n * 2.0 - 1.0), 10.0) * 0.6;
  return a;
}

float blood(vec2 px, vec4 b, float seed) {
  if (b.w <= 0.001) return 0.0;
  vec2 p = (px - b.xy) / b.z;
  p.y += 0.12 * time;
  vec2 q = vec2(fbm(p * 2.2 + vec2(seed, -time * 0.10)), fbm(p * 2.2 + vec2(5.2 + seed, 1.3) - time * 0.08));
  float f = fbm(p * 2.0 + q * 2.4 + vec2(time * 0.05, -time * 0.14));
  vec2 pe = (px - b.xy) / b.z;
  float r2 = dot(pe * vec2(1.0, 0.8), pe * vec2(1.0, 0.8));
  float env = exp(-r2 * 1.3);
  return smoothstep(0.46, 0.8, f + env * 0.22 - 0.06) * mix(env, 1.0, 0.25) * smoothstep(2.4, 0.6, length(pe)) * b.w;
}

float snow(vec2 px, float cell, float off, float seed) {
  vec2 p = px + vec2(0.0, off);
  vec2 c = floor(p / cell); vec2 f = p - c * cell;
  float h = h2(c + seed);
  if (h < 0.6) return 0.0;
  vec2 pos = vec2(h2(c + seed + 1.3), h2(c + seed + 2.7)) * cell;
  float sz = 0.6 + 1.5 * h2(c + seed + 3.1);
  float d = length(f - pos);
  return smoothstep(sz, sz * 0.25, d) * (0.05 + 0.13 * h2(c + seed + 4.9));
}

void main() {
  vec2 px = vec2(v.x * res.x, (1.0 - v.y) * res.y);
  vec2 wob = vec2(noise(px * 0.004 + vec2(time * 0.3, 0.0)), noise(px * 0.004 + vec2(0.0, time * 0.3) + 7.0)) - 0.5;
  vec2 sp = px + wob * 3.0 * (1.0 - inside);
  vec3 bg = water(px);
  vec3 col = bg;
  vec4 g = texture2D(tG, tc(sp));
  vec4 m = texture2D(tM, tc(sp));
  vec3 spill = texture2D(tS, tc(sp)).g * vec3(0.85, 0.94, 0.90);
  vec3 L = normalize(vec3(-0.58, -0.6, 0.55));
  vec3 keyC = vec3(1.0, 0.96, 0.9) * keyI;
  if (g.a > 0.004) {
    float a = g.r * 2.0 - 1.0;
    vec2 pd = g.gb * 2.0 - 1.0;
    float nz = sqrt(max(0.0, 1.0 - a * a));
    vec3 n = vec3(pd * a, nz);
    n.xy += (vec2(noise(px * 0.05), noise(px * 0.05 + 3.3)) - 0.5) * 0.07 + (vec2(noise(px * 0.21), noise(px * 0.21 + 9.1)) - 0.5) * 0.05;
    n = normalize(n);
    float cav = m.r;
    float emit = m.g;
    float dz = m.b * 6000.0;
    float blot = smoothstep(0.45, 0.85, noise(px * 0.0045 + 3.0) * 0.6 + noise(px * 0.013) * 0.4);
    vec3 alb = mix(vec3(0.91, 0.87, 0.81), vec3(0.66, 0.56, 0.58), blot * 0.55);
    alb = mix(alb, vec3(0.38, 0.09, 0.08), smoothstep(0.3, 1.0, cav)) * (1.0 - 0.55 * cav);
    float diff = max(0.0, (dot(n, L) + 0.12) / 1.12);
    vec3 amb = vec3(0.025, 0.055, 0.045) * (0.6 + 0.4 * max(0.0, -n.y));
    vec3 fill = vec3(0.07, 0.09, 0.085) * (0.25 + 0.75 * nz);
    vec3 lit = alb * (keyC * diff + spill * 1.9 * (0.35 + 0.65 * nz) + amb + fill);
    float rim = pow(1.0 - nz, 2.6);
    lit += rim * vec3(0.69, 0.42, 0.35) * (keyI * 0.45 + spill.g * 0.5 + 0.04) * (1.0 - cav);
    lit += alb * vec3(0.30, 0.10, 0.06) * diff * keyI * 0.5;
    // Light passing through thin flesh: red in the shadow side.
    lit += vec3(0.5, 0.1, 0.07) * alb * (1.0 - diff) * (keyI * 0.22 + spill.g * 0.5);
    // A back light from the surface catches the far edges.
    vec2 lb = normalize(vec2(0.62, -0.78));
    lit += vec3(0.75, 0.85, 0.82) * pow(max(0.0, dot(normalize(n.xy + 1e-4), lb)), 3.0) * pow(1.0 - nz, 1.6) * keyI * 0.6 * (1.0 - cav);
    vec3 hh = normalize(L + vec3(0.0, 0.0, 1.0));
    float wet = smoothstep(0.25, 0.8, noise(px * vec2(0.021, 0.034) + vec2(0.0, time * 0.05)));
    float sp1 = pow(max(dot(n, hh), 0.0), 80.0) * 1.9 + pow(max(dot(n, hh), 0.0), 16.0) * 0.26;
    float sp2 = pow(nz, 46.0) * 0.35;
    lit += (keyC * sp1 + spill * sp2 * 1.6) * (0.35 + 0.65 * wet) * (1.0 - cav);
    lit += keyC * pow(caustic(px * 0.004), 0.6) * max(0.0, 0.25 - n.y) * (1.0 - depth) * 0.22 * alb;
    lit += vec3(0.85, 0.94, 0.90) * emit * 1.2;
    float fog = 1.0 - exp(-max(0.0, dz - focus) * 0.0009);
    lit = mix(lit, bg, clamp(fog, 0.0, 0.9));
    col = mix(bg, lit, clamp(g.a, 0.0, 1.0));
  }
  vec4 e = texture2D(tE, tc(sp));
  col = mix(col, e.rgb * mix(0.62 + spill * 0.9 + keyI * 0.25, vec3(1.0), inside), e.a);
  // Blood, only round the one that waits: it absorbs, and turns red where the terminals light it.
  float bd = clamp(blood(px, blood0, 0.0) + blood(px, blood1, 11.0), 0.0, 1.0) * (1.0 - inside);
  float bl = 0.18 + spill.g * 2.2 + keyI * 0.25;
  vec3 bc = mix(vec3(0.54, 0.0, 0.0), vec3(1.0, 0.1, 0.1), clamp(bl - 0.25, 0.0, 1.0));
  col = col * (1.0 - bd * 0.8) + bc * bd * (0.42 + bl * 0.55);
  // Marine snow: fixed in the water, so it streams up while the camera sinks.
  float sn = snow(px, 64.0, snowY * 0.55 + time * 9.0, 0.0) * 1.6 + snow(px, 118.0, snowY * 1.1 + time * 14.0, 7.0) * 1.8;
  // Out-of-focus specks close to the lens.
  vec2 bp = px + vec2(time * 6.0, snowY * 2.6 + time * 30.0);
  vec2 bc0 = floor(bp / 260.0); vec2 bf = bp - bc0 * 260.0;
  float bh = h2(bc0 + 41.0);
  float bok = bh > 0.55 ? smoothstep(10.0 + 14.0 * bh, 4.0, length(bf - vec2(h2(bc0 + 3.0), h2(bc0 + 5.0)) * 260.0)) * 0.07 : 0.0;
  col += vec3(0.75, 0.85, 0.8) * (sn + bok) * (1.0 - inside) * (0.4 + 0.6 * (1.0 - surf));
  // Grade: lift the blacks toward the green of the water, keep the whites of the flesh warm.
  col = col / (1.0 + col * 0.18);
  col = pow(max(col, 0.0), vec3(1.04, 1.0, 1.02));
  vec2 q = px / res - 0.5;
  col *= 1.0 - 0.38 * pow(length(q * vec2(1.0, 0.82)) * 1.3, 2.2);
  col += (h2(px + fract(time * 7.13) * 911.0) - 0.5) * 0.065;
  // The surface becomes one bright line: the tube the end card switches on from.
  if (collapse > 0.0) {
    float hgt = max(1.5, res.y * 0.5 * pow(1.0 - collapse, 2.2));
    float band = exp(-pow((px.y - res.y * 0.5) / hgt, 2.0));
    vec3 lineC = vec3(0.88, 0.94, 1.0) * mix(1.0, 1.35, collapse);
    col = mix(col, lineC * band, smoothstep(0.0, 0.35, collapse));
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

  function glSetup(canvas) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('abyss: WebGL unavailable');
    const compile = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('abyss: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const texs = ['tG', 'tM', 'tE', 'tS'].map((name, i) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), i);
      return tex;
    });
    const U = {};
    ['res', 'time', 'depth', 'keyI', 'surf', 'collapse', 'inside', 'snowY', 'focus', 'sigil', 'blood0', 'blood1'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    gl.viewport(0, 0, canvas.width, canvas.height);
    return { gl, texs, U };
  }

  /* ---- Fonts ---- */
  const MONO = '"Wavi Mono", "JetBrains Mono", monospace';

  function create(canvas) {
    canvas.width = W;
    canvas.height = H;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const cG = mk(W, H); const cM = mk(W, H); const cE = mk(W, H); const cS = mk(480, 270);
    const g = cG.getContext('2d'); const mt = cM.getContext('2d'); const e = cE.getContext('2d'); const sp = cS.getContext('2d');
    const glx = glSetup(canvas);
    const sphere = SPHERE(); const sucker = SUCKER();
    const orbit = new Path2D(window.WAVI_ORBIT.d);
    const OVB = window.WAVI_ORBIT.viewBox;
    const { E: EYE0 } = buildCamera();

    // The row of the waiting arm that holds its last line when it stops (just root-side of the eye).
    const rows0 = rowsFor(armGeom(0, 20));
    let jStuck = 0;
    rows0.forEach((s, j) => { if (Math.abs(s - 0.3) < Math.abs(rows0[jStuck] - 0.3)) jStuck = j; });
    const kStuck = Math.floor(armTau(0, 20) / 0.4);
    const offCookie = 10 - kStuck + jStuck;
    let jBloom = 0;
    rows0.forEach((s, j) => { if (Math.abs(s - 0.425) < Math.abs(rows0[jBloom] - 0.425)) jBloom = j; });

    let cam = null;
    let F = F0;
    let cr = 1; let sr = 0;
    function proj(P) {
      const dz = P[2] - cam.z;
      if (dz < 30) return null;
      const s = F / dz;
      const x = (P[0] - cam.x) * s; const y = (P[1] - cam.y) * s;
      return { x: CX + x * cr - y * sr, y: CY + x * sr + y * cr, s, dz };
    }
    const dByte = (dz) => Math.max(0, Math.min(255, Math.round((dz / 6000) * 255)));

    function rowsFor(geo) {
      const out = [];
      if (!geo) return out;
      let s = 0.05;
      while (s < 0.95) {
        out.push(s);
        const r = at(geo, s).r;
        s += Math.max(0.004, (0.74 * r) / geo.len);
      }
      return out;
    }

    /** Draws one tube (centreline pts, radii) into the normal and material buffers; returns its projected rows. */
    function tube(pts, rad, opt) {
      const n = pts.length;
      const P = pts.map(proj);
      const C = []; const T = []; const R = [];
      for (let k = 0; k < n; k++) {
        const a = P[Math.max(0, k - 1)]; const b = P[Math.min(n - 1, k + 1)];
        if (!P[k] || !a || !b) { C.push(null); T.push(null); R.push(0); continue; }
        let tx = b.x - a.x; let ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        C.push(P[k]); T.push([tx, ty]); R.push(rad[k] * P[k].s);
      }
      const quads = [];
      for (let k = 0; k < n - 1; k++) {
        if (!C[k] || !C[k + 1]) continue;
        const r0 = R[k]; const r1 = R[k + 1];
        if (r0 < 0.3 && r1 < 0.3) continue;
        quads.push(k);
      }
      // Back to front within the tube, so a coil passes in front of itself.
      quads.sort((i, j) => C[j].dz + C[j + 1].dz - C[i].dz - C[i + 1].dz);
      for (const k of quads) {
        const c0 = C[k]; const c1 = C[k + 1];
        // Seen end-on a tube is a disc, not a ribbon: stamp one where the segment is foreshortened.
        const segLen = Math.hypot(c1.x - c0.x, c1.y - c0.y);
        const A3 = pts[k]; const B3 = pts[k + 1];
        const wl = Math.hypot(B3[0] - A3[0], B3[1] - A3[1], B3[2] - A3[2]) * c0.s;
        if (segLen < wl * 0.45 && segLen < R[k] * 0.8 && R[k] > 1.5) {
          g.drawImage(sphere, c0.x - R[k], c0.y - R[k], R[k] * 2, R[k] * 2);
          mt.fillStyle = `rgb(0,0,${dByte(c0.dz)})`;
          mt.beginPath(); mt.arc(c0.x, c0.y, R[k] * 0.98, 0, TAU); mt.fill();
        }
        const t0 = T[k]; const t1 = T[k + 1];
        const pxp = -(t0[1] + t1[1]) / 2; const pyp = (t0[0] + t1[0]) / 2;
        const pl = Math.hypot(pxp, pyp) || 1;
        const nx = pxp / pl; const ny = pyp / pl;
        const ex = 1.2; // overlap so no seam shows between quads
        const ax = t0[0] * ex; const ay = t0[1] * ex; const bx = t1[0] * ex; const by = t1[1] * ex;
        const p0 = [c0.x - t0[1] * -R[k] - ax, c0.y + t0[0] * -R[k] - ay];
        const p1 = [c1.x - t1[1] * -R[k + 1] + bx, c1.y + t1[0] * -R[k + 1] + by];
        const p2 = [c1.x - t1[1] * R[k + 1] + bx, c1.y + t1[0] * R[k + 1] + by];
        const p3 = [c0.x - t0[1] * R[k] - ax, c0.y + t0[0] * R[k] - ay];
        const mx = (c0.x + c1.x) / 2; const my = (c0.y + c1.y) / 2; const rr = (R[k] + R[k + 1]) / 2;
        const gg = Math.round((nx * 0.5 + 0.5) * 255); const gb = Math.round((ny * 0.5 + 0.5) * 255);
        const grd = g.createLinearGradient(mx - nx * rr, my - ny * rr, mx + nx * rr, my + ny * rr);
        grd.addColorStop(0, `rgb(0,${gg},${gb})`);
        grd.addColorStop(1, `rgb(255,${gg},${gb})`);
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.closePath(); g.fill();
        const db = dByte((c0.dz + c1.dz) / 2);
        mt.fillStyle = `rgb(${opt.cav0 || 0},0,${db})`;
        mt.beginPath(); mt.moveTo(p0[0], p0[1]); mt.lineTo(p1[0], p1[1]); mt.lineTo(p2[0], p2[1]); mt.lineTo(p3[0], p3[1]); mt.closePath(); mt.fill();
        // Wrinkle rings across the flesh, anchored to it.
        const ring = opt.ring || 0.75;
        const arc0 = opt.arc[k]; const arc1 = opt.arc[k + 1];
        const r0w = rad[k];
        const ci0 = Math.floor(arc0 / (ring * r0w)); const ci1 = Math.floor(arc1 / (ring * r0w));
        if (ci0 !== ci1 && rr > 2) {
          // A soft fold, never a full ring: partial, wavy, of varying depth.
          const hh = hash(ci1 * 3.7 + (opt.seed || 0) * 11.3);
          const a1 = -0.95 + 0.6 * hash(ci1 * 1.3 + 0.5); const a2 = 0.95 - 0.6 * hash(ci1 * 2.9 + 0.2);
          const bow = (hash(ci1 * 5.1) - 0.5) * 0.5 * rr;
          mt.strokeStyle = `rgba(${Math.round((opt.ringCav || 110) * (0.45 + 0.55 * hh))},0,${db},0.9)`;
          mt.lineWidth = Math.max(0.7, rr * (0.018 + 0.03 * hh));
          const cx1 = c1.x + t1[0] * bow * 0.2; const cy1 = c1.y + t1[1] * bow * 0.2;
          mt.beginPath();
          mt.moveTo(cx1 - t1[1] * rr * a1, cy1 + t1[0] * rr * a1);
          mt.quadraticCurveTo(cx1 - t1[0] * bow, cy1 - t1[1] * bow, cx1 - t1[1] * rr * a2, cy1 + t1[0] * rr * a2);
          mt.stroke();
        }
      }
      // Two veins along the tube.
      if (opt.veins) {
        for (let v = 0; v < 2; v++) {
          mt.beginPath();
          let started = false;
          for (let k = 0; k < n; k++) {
            if (!C[k] || R[k] < 3) { started = false; continue; }
            const a = (v ? 0.38 : -0.22) + 0.22 * Math.sin(opt.arc[k] * 0.011 + v * 2 + opt.seed) + 0.09 * Math.sin(opt.arc[k] * 0.043 + v * 5 + opt.seed * 3);
            const x = C[k].x - T[k][1] * R[k] * a; const y = C[k].y + T[k][0] * R[k] * a;
            if (!started) { mt.moveTo(x, y); started = true; } else mt.lineTo(x, y);
          }
          mt.strokeStyle = `rgba(70,0,${dByte(C[Math.floor(n / 3)] ? C[Math.floor(n / 3)].dz : 3000)},0.55)`;
          mt.lineWidth = Math.max(0.5, (R[Math.floor(n / 4)] || 4) * 0.018);
          mt.stroke();
        }
      }
      return { C, T, R };
    }

    function lerpRow(proj3, s) {
      const n = proj3.C.length - 1;
      const f = Math.max(0, Math.min(n - 1e-6, s * n));
      const k = Math.floor(f); const u = f - k;
      const a = proj3.C[k]; const b = proj3.C[k + 1];
      if (!a || !b) return null;
      const ta = proj3.T[k]; const tb = proj3.T[k + 1];
      let tx = lerp(ta[0], tb[0], u); let ty = lerp(ta[1], tb[1], u); const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), dz: lerp(a.dz, b.dz, u), r: lerp(proj3.R[k], proj3.R[k + 1], u), tx, ty };
    }

    function glyphCorner(ctx, x, y, em) {
      ctx.lineWidth = Math.max(1, em * 0.08);
      ctx.beginPath(); ctx.moveTo(x + em * 0.25, y - em * 0.55); ctx.lineTo(x + em * 0.25, y + em * 0.05); ctx.lineTo(x + em * 0.8, y + em * 0.05); ctx.stroke();
    }
    function glyphStar(ctx, x, y, em) {
      ctx.lineWidth = Math.max(1, em * 0.09);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + 0.3; ctx.moveTo(x + em * 0.32, y - em * 0.18); ctx.lineTo(x + em * 0.32 + Math.cos(a) * em * 0.3, y - em * 0.18 + Math.sin(a) * em * 0.3); }
      ctx.stroke();
    }
    /** A terminal line written in light (into the material buffer's G), bullet glyphs drawn as the terminal draws them. */
    function termLine(ctx, line, x, y, em, maxW, color) {
      ctx.font = `500 ${em}px ${MONO}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = color; ctx.strokeStyle = color;
      let s = line; let x0 = x;
      const ch = s[0];
      if (ch === '⎿') { glyphCorner(ctx, x0, y + em * 0.1, em); x0 += em * 1.3; s = s.slice(1); }
      else if (ch === '✻') { glyphStar(ctx, x0, y + em * 0.15, em); x0 += em * 0.9; s = s.slice(1); }
      else if (ch === '⏺' || ch === '•') { s = s.slice(1); }
      ctx.fillText(s, x0, y, Math.max(4, maxW - (x0 - x)));
    }

    /** Suckers and the lines of output written across the arm, one per row. */
    function rows(geo, pr, i, t, info) {
      const a = ARMS[i];
      const rws = rowsFor(geo);
      const feedName = i === 0 && t >= K.shut ? 'cookieAfter' : a.feed;
      const feed = FEEDS[feedName];
      const kTick = Math.floor(geo.tau / 0.4);
      const off = i === 0 ? (t >= K.shut ? -Math.floor(armTau(0, K.shut) / 0.4) : offCookie) : i * 5;
      const eyeOpen = i === 0 && info.eyeO > 0.02;
      rws.forEach((s, j) => {
        if (s > 0.985) return;
        const q = lerpRow(pr, s);
        if (!q || q.r < 1.2) return;
        if (eyeOpen && Math.abs(s - S_EYE) < 0.06) return;
        if (info.stuck > 0 && i === 0 && Math.abs(s - rws[jStuck]) < 0.05 && j !== jStuck) return;
        const line = feed[mod(kTick - j + off, feed.length)];
        const sub = line[0] === '⎿' || line[0] === '└' || !/[⏺•✻>]/.test(line[0]);
        const blank = line.trim() === '';
        // Text reads left to right: the side the sucker sits on is the start of the line.
        const nx = -q.ty; const ny = q.tx;
        const flip = nx < 0 ? -1 : 1;
        const dxv = nx * flip; const dyv = ny * flip;
        const db = dByte(q.dz);
        let bright = blank ? 0.08 : sub ? 0.3 : 0.72;
        if (i === 0 && t >= K.freeze1 && t < K.shut) bright *= j === jStuck ? 1.0 : 0.55;
        bright *= info.light;
        const sa = -0.66; const rs = q.r * (sub || blank ? 0.22 : 0.31);
        const sx = q.x + dxv * q.r * sa; const sy = q.y + dyv * q.r * sa;
        g.drawImage(sucker, sx - rs, sy - rs, rs * 2, rs * 2);
        const sg = mt.createRadialGradient(sx, sy, 0, sx, sy, rs);
        const E8 = Math.round(255 * bright);
        sg.addColorStop(0, `rgba(70,${Math.round(E8 * 0.42)},${db},1)`);
        sg.addColorStop(0.28, `rgba(140,${Math.round(E8 * 0.18)},${db},1)`);
        sg.addColorStop(0.46, `rgba(235,0,${db},1)`);
        sg.addColorStop(0.62, `rgba(0,0,${db},1)`);
        sg.addColorStop(0.8, `rgba(40,0,${db},1)`);
        sg.addColorStop(1, `rgba(110,0,${db},0)`);
        mt.fillStyle = sg;
        mt.beginPath(); mt.arc(sx, sy, rs, 0, TAU); mt.fill();
        if (i === 0 && j === jBloom) info.out.bloom = { x: sx, y: sy, s: q.r / Math.max(1, at(geo, s).r) };
        if (blank) return;
        const avail = q.r * 1.24;
        const em = Math.min(q.r * 0.14, (avail * 1.25) / (Math.max(12, line.length) * 0.6));
        if (em < 3.2) return;
        mt.save();
        mt.translate(q.x + dxv * q.r * -0.28, q.y + dyv * q.r * -0.28);
        mt.rotate(Math.atan2(dyv, dxv));
        const small = Math.max(0.22, Math.min(1, (em - 3) / 9));
        const tc = `rgb(0,${Math.round(255 * bright * small * (sub ? 0.75 : 1))},${db})`;
        mt.shadowColor = `rgba(0,${Math.round(160 * bright * small)},${db},0.6)`; mt.shadowBlur = em * 0.6;
        termLine(mt, line, 0, 0, em, avail, tc);
        mt.shadowBlur = 0;
        mt.restore();
      });
      // While it waits, its last line is written large along the arm, so it reads in a flat framing.
      if (i === 0 && info.stuck > 0.01) {
        const q = lerpRow(pr, rws[jStuck]);
        if (q) {
          let ang = Math.atan2(q.ty, q.tx);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
          const em = Math.min(q.r * 0.3, 54);
          const db = dByte(q.dz);
          const c = `rgb(0,${Math.round(255 * info.stuck)},${db})`;
          mt.save(); mt.translate(q.x, q.y); mt.rotate(ang);
          mt.shadowColor = `rgba(0,${Math.round(150 * info.stuck)},${db},0.6)`; mt.shadowBlur = em * 0.5;
          mt.font = `500 ${em}px ${MONO}`; mt.textAlign = 'center'; mt.textBaseline = 'middle'; mt.fillStyle = c;
          mt.fillText('The Session table needs a migration first.', 0, q.r * 0.35);
          mt.restore();
        }
      }
      // The worktree's name, written along the root.
      if (info.label > 0.01) {
        const q = lerpRow(pr, 0.07);
        if (q && q.r > 6) {
          let ang = Math.atan2(q.ty, q.tx);
          let dir = 1;
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) { ang += Math.PI; dir = -1; }
          const em = Math.max(30, Math.min(40, q.r * 0.75));
          const db = dByte(q.dz);
          mt.save();
          mt.translate(q.x, q.y);
          mt.rotate(ang);
          mt.font = `600 ${em}px ${MONO}`;
          mt.textAlign = dir > 0 ? 'left' : 'right';
          mt.textBaseline = 'middle';
          mt.fillStyle = `rgb(0,${Math.round(255 * info.label)},${db})`;
          mt.fillText(a.name, 0, 0);
          mt.restore();
        }
      }
    }

    function drawArm(i, t, geo, info) {
      const arc = geo.ss.map((s) => s * geo.len);
      const pr = tube(geo.pts, geo.rad, { arc, veins: true, seed: i * 1.7 });
      rows(geo, pr, i, t, info);
      return pr;
    }

    function drawSpine(t, info) {
      const pts = []; const rad = []; const arc = [];
      const y0 = HEAD.y + 250; const y1 = 3800; const N = 150;
      for (let k = 0; k <= N; k++) {
        const y = lerp(y0, y1, k / N);
        pts.push(spinePoint(y, t));
        const top = 1 - ramp(y, y0, y0 + 500);
        const vert = Math.pow(Math.abs(Math.sin((y / 150) * Math.PI)), 0.6);
        rad.push(SPINE_R * (1 + 0.9 * top * top) * (0.9 + 0.13 * vert));
        arc.push(y);
      }
      const pr = tube(pts, rad, { arc, ring: 0.6, ringCav: 150, veins: true, seed: 9 });
      // "main", and a merge commit written on it for every arm that has come home.
      const yLabel = cam.y - 420 * (cam.z / -2600);
      const q = lerpRow(pr, clamp01((yLabel - y0) / (y1 - y0)));
      if (q && q.r > 8 && info.mainLabel > 0.01) {
        const em = Math.max(30, Math.min(44, q.r * 0.6));
        mt.save(); mt.translate(q.x, q.y); mt.rotate(Math.atan2(q.ty, q.tx) + Math.PI);
        mt.font = `600 ${em}px ${MONO}`; mt.textAlign = 'center'; mt.textBaseline = 'middle';
        mt.fillStyle = `rgb(0,${Math.round(255 * info.mainLabel)},${dByte(q.dz)})`;
        mt.fillText('main', 0, 0);
        mt.restore();
      }
      ARMS.forEach((a, i) => {
        const k = ramp(t, MERGE(i) + 0.7, MERGE(i) + 0.9);
        if (k <= 0) return;
        const qq = lerpRow(pr, clamp01((a.rootY - y0) / (y1 - y0)));
        if (!qq || qq.r < 5) return;
        const em = Math.min(qq.r * 0.16, (qq.r * 1.6) / (22 * 0.6));
        if (em < 3) return;
        mt.save(); mt.translate(qq.x - qq.r * 0.8, qq.y); mt.rotate(0);
        termLine(mt, `•Merge branch '${a.name}'`, 0, 0, em, qq.r * 1.6, `rgb(0,${Math.round(230 * k * info.light)},${dByte(qq.dz)})`);
        mt.restore();
      });
    }

    function drawHead(t, info) {
      const c = spinePoint(HEAD.y, t);
      c[0] = 0; c[2] = 0;
      const P = proj(c);
      if (!P) return;
      const r = HEAD.r * P.s;
      if (r < 4 || P.y + r * 1.4 < -50 || P.y - r * 1.4 > H + 50) return;
      // The mantle: a tall egg of the same flesh.
      const rx = r * 0.95; const ry = r * 1.3;
      // Lobes behind the mantle so its outline is never a clean egg.
      [[-0.58, 0.46, 0.42], [0.56, 0.5, 0.4]].forEach(([u, v, k]) => {
        const lx = P.x + u * rx; const ly = P.y + v * ry; const lr = r * k;
        g.drawImage(sphere, lx - lr, ly - lr * 1.05, lr * 2, lr * 2.1);
        mt.fillStyle = `rgb(40,0,${dByte(P.dz + HEAD.r * 0.3)})`;
        mt.beginPath(); mt.ellipse(lx, ly, lr * 0.99, lr * 1.04, 0, 0, TAU); mt.fill();
      });
      // A mantle swelling up and back over a lower bulb: two masses, a crease between them.
      const db = dByte(P.dz);
      [[0, 0, 1, 1]].forEach(([u, v, kx, ky]) => {
        const ex = P.x + u * rx; const ey = P.y + v * ry; const ax = rx * kx; const ay = ry * ky;
        g.drawImage(sphere, ex - ax, ey - ay, ax * 2, ay * 2);
        mt.fillStyle = `rgb(0,0,${db})`;
        mt.beginPath(); mt.ellipse(ex, ey, ax * 0.995, ay * 0.995, 0, 0, TAU); mt.fill();
      });
      // Folds that run down the mantle from the crown, and heavy creases low on it; never a full line.
      mt.lineCap = 'round';
      for (let f = 0; f < 14; f++) {
        const u0 = (f / 13 - 0.5) * 1.5 + (hash(f * 1.7) - 0.5) * 0.12;
        const top = -0.9 + Math.abs(u0) * 0.3 + hash(f * 2.3) * 0.25;
        const bot = top + 0.5 + 0.6 * hash(f * 3.1);
        const xs = (v) => P.x + rx * u0 * Math.sqrt(Math.max(0.05, 1 - v * v)) * 1.02;
        mt.strokeStyle = `rgba(${Math.round(90 + 110 * hash(f * 6.1))},0,${db},0.8)`;
        mt.lineWidth = Math.max(0.8, r * (0.004 + 0.01 * hash(f * 7.3)));
        mt.beginPath(); mt.moveTo(xs(top), P.y + top * ry);
        const vm = (top + bot) / 2;
        mt.quadraticCurveTo(xs(vm) + (hash(f * 8.9) - 0.5) * r * 0.12, P.y + vm * ry, xs(bot), P.y + Math.min(0.97, bot) * ry);
        mt.stroke();
      }
      for (let f = 0; f < 6; f++) {
        const v = 0.42 + f * 0.09;
        const w = Math.sqrt(Math.max(0, 1 - v * v)) * rx;
        mt.strokeStyle = `rgba(${Math.round(150 + 80 * hash(f * 2.9))},0,${db},0.85)`;
        mt.lineWidth = Math.max(1, r * (0.008 + 0.012 * hash(f * 3.7)));
        mt.beginPath();
        mt.moveTo(P.x - w * (0.75 + 0.2 * hash(f)), P.y + v * ry);
        mt.quadraticCurveTo(P.x + (hash(f * 4.1) - 0.5) * w * 0.4, P.y + (v + 0.07) * ry, P.x + w * (0.7 + 0.25 * hash(f * 5.3)), P.y + (v - 0.02) * ry);
        mt.stroke();
      }
      // The Wavi orbit, carved: a dark groove with the terminals' light pooled in it.
      const ms = (rx * 1.2) / OVB[2];
      const lw = (px) => px / ms;
      mt.save();
      mt.translate(P.x, P.y - ry * 0.02);
      mt.scale(ms, ms);
      mt.translate(-(OVB[0] + OVB[2] / 2), -(OVB[1] + OVB[3] / 2));
      mt.lineJoin = 'round';
      mt.fillStyle = `rgba(205,${Math.round(40 * info.sigil)},${db},1)`;
      mt.fill(orbit, 'evenodd');
      mt.strokeStyle = `rgba(250,0,${db},1)`;
      mt.lineWidth = lw(Math.max(1.5, r * 0.01));
      mt.stroke(orbit);
      if (info.sigil > 0.01) {
        mt.filter = `blur(${Math.max(1, r * 0.006).toFixed(1)}px)`;
        mt.strokeStyle = `rgba(150,${Math.round(110 * info.sigil)},${db},1)`;
        mt.lineWidth = lw(Math.max(1.5, r * 0.007));
        mt.stroke(orbit);
        mt.filter = 'none';
      }
      mt.restore();
    }

    /** The face: short arms hanging from the lower front of the head, trailing as it rises. */
    function drawFace(t, info) {
      const c = spinePoint(HEAD.y, t);
      for (let k = 0; k < 9; k++) {
        const u = (k / 8 - 0.5) * 1.15;
        const root = [u * HEAD.r * 0.8, HEAD.y + riseY(t) + HEAD.r * (0.95 + 0.12 * Math.cos(u * 2.5)), -HEAD.r * (0.3 - 0.15 * Math.abs(u))];
        const L = HEAD.r * (2.0 + 1.0 * hash(k * 3.3)) * (1 - 0.3 * Math.abs(u));
        const N = 70; const pts = []; const rad = []; const arc = [];
        let yaw = -Math.PI / 2 + u * 1.4; let pitch = 1.5;
        const p = root.slice();
        const ph = k * 1.9;
        for (let i = 0; i <= N; i++) {
          const s = i / N;
          pts.push([p[0], p[1], p[2]]);
          rad.push(HEAD.r * 0.16 * (1 - 0.9 * Math.pow(s, 0.8)));
          arc.push(s * L);
          // Rising, the arms trail and curl.
          yaw += (2.2 * Math.sin(TAU * (0.8 * s - 0.25 * t) + ph) * (0.2 + s)) / N;
          pitch += ((1.6 * Math.sin(TAU * (0.6 * s - 0.2 * t) + ph * 1.3) * (0.2 + s)) - 0.4 * s) / N;
          pitch = Math.max(0.9, Math.min(1.56, pitch));
          p[0] += Math.cos(pitch) * Math.cos(yaw) * (L / N);
          p[1] += Math.sin(pitch) * (L / N);
          p[2] += Math.cos(pitch) * Math.sin(yaw) * (L / N);
        }
        tube(pts, rad, { arc, veins: true, seed: 20 + k, ring: 0.5 });
      }
      void c; void info;
    }

    /** The eye on the waiting arm, in colour, and the prompt you see when the camera is inside its pupil. */
    function drawEye(t, geo, info) {
      e.clearRect(0, 0, W, H);
      const o = info.eyeO;
      const inside = info.inside;
      if (o > 0.002 && geo) {
        const A = at(geo, S_EYE);
        const P = proj(A.p);
        const pa = proj(at(geo, S_EYE - 0.01).p); const pb = proj(at(geo, S_EYE + 0.01).p);
        if (P && pa && pb) {
          const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
          const Wd = 3.0 * A.r * P.s;
          const ht = 0.36 * Wd * o; const hb = 0.27 * Wd * o;
          e.save();
          e.translate(P.x, P.y);
          e.rotate(ang + (Math.cos(ang) < 0 ? Math.PI : 0));
          const almond = (k, extra) => {
            const a = ht * k + (extra || 0); const b = hb * k + (extra || 0); const w = (Wd / 2) * (1 + (k - 1) * 0.5);
            e.beginPath();
            e.moveTo(-w, 0);
            e.bezierCurveTo(-w * 0.56, -a * 1.25, w * 0.52, -a * 1.3, w, 0);
            e.bezierCurveTo(w * 0.5, b * 1.3, -w * 0.54, b * 1.25, -w, 0);
            e.closePath();
          };
          // The socket: shadowed, swollen flesh round a raw wet lid.
          const sw = e.createRadialGradient(0, 0, Wd * 0.18, 0, 0, Wd * 0.64);
          sw.addColorStop(0, 'rgba(22,6,4,0.8)'); sw.addColorStop(0.65, 'rgba(30,8,6,0.4)'); sw.addColorStop(1, 'rgba(30,8,6,0)');
          e.fillStyle = sw;
          e.beginPath(); e.ellipse(0, 0, Wd * 0.64, (ht + hb) * 0.9 + Wd * 0.06, 0, 0, TAU); e.fill();
          almond(1.05, Wd * 0.012);
          const lid = e.createRadialGradient(0, 0, Wd * 0.2, 0, 0, Wd * 0.54);
          lid.addColorStop(0, '#5a1c16'); lid.addColorStop(0.8, '#7a3a2e'); lid.addColorStop(1, 'rgba(150,100,90,0.4)');
          e.fillStyle = lid; e.fill();
          e.save();
          almond(1); e.clip();
          // The ball: yellowed, round, wet.
          const bg = e.createRadialGradient(-Wd * 0.08, -ht * 0.35, Wd * 0.02, 0, 0, Wd * 0.55);
          bg.addColorStop(0, '#ece2cd'); bg.addColorStop(0.45, '#d3c1a1'); bg.addColorStop(0.78, '#8f7357'); bg.addColorStop(1, '#2e1a12');
          e.fillStyle = bg;
          e.fillRect(-Wd, -Wd, Wd * 2, Wd * 2);
          for (let b = 0; b < 4; b++) {
            const bx = (b < 2 ? -1 : 1) * Wd * (0.3 + 0.1 * hash(b * 3.3)); const by = (hash(b * 7.1) - 0.5) * (ht + hb) * 0.6;
            const bl = e.createRadialGradient(bx, by, 0, bx, by, Wd * 0.12);
            bl.addColorStop(0, 'rgba(150,30,22,0.28)'); bl.addColorStop(1, 'rgba(150,30,22,0)');
            e.fillStyle = bl; e.fillRect(bx - Wd * 0.12, by - Wd * 0.12, Wd * 0.24, Wd * 0.24);
          }
          // Veins, branching, slightly out of focus under the wet surface.
          e.filter = `blur(${Math.max(0.4, Wd * 0.0012).toFixed(2)}px)`;
          for (let v = 0; v < 26; v++) {
            const side = v % 2 ? 1 : -1;
            const y0 = (hash(v * 3.1) - 0.5) * (ht + hb) * 1.1;
            const x0 = side * Wd * 0.5;
            const x1 = side * Wd * (0.2 + 0.12 * hash(v * 7.7)); const y1 = y0 * 0.35 + (hash(v * 5.3) - 0.5) * Wd * 0.07;
            const xm = lerp(x0, x1, 0.55); const ym = lerp(y0, y1, 0.55) + (hash(v * 9.1) - 0.5) * Wd * 0.05;
            e.strokeStyle = `rgba(${110 + Math.round(50 * hash(v))},${Math.round(8 * hash(v * 2))},6,${0.3 + 0.4 * hash(v * 1.9)})`;
            e.lineWidth = Math.max(0.6, Wd * (0.0018 + 0.0035 * hash(v * 2.3)));
            e.beginPath(); e.moveTo(x0, y0); e.quadraticCurveTo(lerp(x0, xm, 0.5), y0 + (hash(v * 4.4) - 0.5) * Wd * 0.06, xm, ym); e.lineTo(x1, y1); e.stroke();
            e.lineWidth *= 0.6;
            e.beginPath(); e.moveTo(xm, ym); e.quadraticCurveTo(xm - side * Wd * 0.04, ym + Wd * 0.03 * (hash(v * 8.8) - 0.3), xm - side * Wd * 0.07, ym + Wd * 0.05 * (hash(v * 6.2) - 0.5)); e.stroke();
          }
          e.filter = 'none';
          // The question, inked in the white.
          const ri = 0.17 * Wd;
          const ix = info.look * Wd * 0.012; const iy = -ht * 0.06;
          const em = Wd * 0.043;
          e.font = `600 ${em}px ${MONO}`;
          e.textBaseline = 'middle';
          e.fillStyle = 'rgba(46,3,3,0.88)';
          const arcText = (s, x0, x1) => {
            const tw = e.measureText(s).width;
            const k = Math.min(1, (x1 - x0) / tw);
            let x = (x0 + x1) / 2 - (tw * k) / 2;
            for (const ch of s) {
              const cw = e.measureText(ch).width * k;
              const xc = x + cw / 2;
              const yy = iy + Math.pow(xc / (Wd / 2), 2) * ht * -0.18 + em * 0.05;
              e.save(); e.translate(xc, yy); e.scale(k, 1); e.textAlign = 'center'; e.fillText(ch, 0, 0); e.restore();
              x += cw;
            }
          };
          arcText('Do you want', -Wd * 0.405, ix - ri - Wd * 0.02);
          arcText('to proceed?', ix + ri + Wd * 0.02, Wd * 0.405);
          // Iris: magenta, deep, fibred, with a collarette and crypts; the pupil.
          const ig = e.createRadialGradient(ix, iy - ri * 0.1, ri * 0.08, ix, iy, ri);
          ig.addColorStop(0, '#ff8ac6'); ig.addColorStop(0.35, '#ff5fb0'); ig.addColorStop(0.68, '#cc3f8c'); ig.addColorStop(0.9, '#701a4b'); ig.addColorStop(1, '#14030c');
          e.fillStyle = ig;
          e.beginPath(); e.arc(ix, iy, ri, 0, TAU); e.fill();
          for (let f = 0; f < 110; f++) {
            const fa = (f / 110) * TAU + hash(f) * 0.04;
            e.strokeStyle = f % 3 === 0 ? 'rgba(255,200,230,0.3)' : 'rgba(90,14,52,0.34)';
            e.lineWidth = Math.max(0.5, ri * (0.006 + 0.01 * hash(f * 9.1)));
            const r0 = ri * (0.3 + 0.08 * hash(f * 3.3)); const r1 = ri * (0.86 + 0.1 * hash(f * 1.1));
            e.beginPath(); e.moveTo(ix + Math.cos(fa) * r0, iy + Math.sin(fa) * r0);
            e.quadraticCurveTo(ix + Math.cos(fa + 0.1) * (r0 + r1) / 2, iy + Math.sin(fa + 0.1) * (r0 + r1) / 2, ix + Math.cos(fa) * r1, iy + Math.sin(fa) * r1);
            e.stroke();
          }
          for (let f = 0; f < 14; f++) {
            const fa = hash(f * 5.5) * TAU; const fr = ri * (0.45 + 0.35 * hash(f * 2.2));
            e.fillStyle = 'rgba(60,8,36,0.45)';
            e.beginPath(); e.ellipse(ix + Math.cos(fa) * fr, iy + Math.sin(fa) * fr, ri * 0.05, ri * 0.02, fa, 0, TAU); e.fill();
          }
          e.strokeStyle = 'rgba(255,170,215,0.35)'; e.lineWidth = Math.max(0.6, ri * 0.02);
          e.beginPath(); e.arc(ix, iy, ri * 0.56, 0, TAU); e.stroke();
          e.strokeStyle = 'rgba(16,2,8,0.85)'; e.lineWidth = Math.max(1, ri * 0.05);
          e.beginPath(); e.arc(ix, iy, ri * 0.985, 0, TAU); e.stroke();
          const rp = ri * 0.42 * info.dilate;
          const pg = e.createRadialGradient(ix, iy, rp * 0.85, ix, iy, rp * 1.05);
          pg.addColorStop(0, '#030102'); pg.addColorStop(1, 'rgba(3,1,2,0)');
          e.fillStyle = pg;
          e.beginPath(); e.arc(ix, iy, rp * 1.05, 0, TAU); e.fill();
          // Shadow of the upper lid and the corners, then the wet light.
          const ls = e.createLinearGradient(0, -ht * 1.1, 0, -ht * 1.1 + Wd * 0.17);
          ls.addColorStop(0, 'rgba(0,0,0,0.75)'); ls.addColorStop(1, 'rgba(0,0,0,0)');
          e.fillStyle = ls; e.fillRect(-Wd, -ht * 1.4, Wd * 2, Wd * 0.22 + ht * 0.4);
          [-1, 1].forEach((sd) => {
            const cg = e.createRadialGradient(sd * Wd * 0.5, 0, 0, sd * Wd * 0.5, 0, Wd * 0.16);
            cg.addColorStop(0, 'rgba(60,10,6,0.85)'); cg.addColorStop(1, 'rgba(60,10,6,0)');
            e.fillStyle = cg; e.fillRect(sd * Wd * 0.5 - Wd * 0.16, -Wd * 0.16, Wd * 0.32, Wd * 0.32);
          });
          e.fillStyle = 'rgba(255,255,255,0.16)';
          e.beginPath(); e.ellipse(-Wd * 0.12, -ht * 0.42, Wd * 0.16, ht * 0.16, -0.12, 0, TAU); e.fill();
          e.fillStyle = 'rgba(255,255,255,0.9)';
          e.beginPath(); e.ellipse(ix - ri * 0.34, iy - ri * 0.4, ri * 0.11, ri * 0.075, -0.5, 0, TAU); e.fill();
          e.fillStyle = 'rgba(255,255,255,0.5)';
          e.beginPath(); e.arc(ix + ri * 0.28, iy + ri * 0.3, ri * 0.035, 0, TAU); e.fill();
          e.restore();
          // The lid margin: dark, raw, with a wet line on the lower lid.
          almond(1);
          e.lineWidth = Math.max(1.5, Wd * 0.016);
          e.strokeStyle = '#2c0806';
          e.stroke();
          e.strokeStyle = 'rgba(244,222,206,0.5)';
          e.lineWidth = Math.max(1, Wd * 0.005);
          e.beginPath(); e.moveTo(-Wd * 0.38, hb * 0.42); e.bezierCurveTo(-Wd * 0.2, hb * 1.08, Wd * 0.2, hb * 1.08, Wd * 0.38, hb * 0.42); e.stroke();
          e.restore();
          info.eyeAt = { x: P.x, y: P.y, w: Wd };
        }
      } else if (info.scar > 0.01 && geo) {
        const A = at(geo, S_EYE); const P = proj(A.p);
        const pa = proj(at(geo, S_EYE - 0.01).p); const pb = proj(at(geo, S_EYE + 0.01).p);
        if (P && pa && pb) {
          const Wd = 3.0 * A.r * P.s;
          e.save(); e.translate(P.x, P.y); e.rotate(Math.atan2(pb.y - pa.y, pb.x - pa.x));
          e.strokeStyle = `rgba(40,6,4,${0.85 * info.scar})`;
          e.lineWidth = Math.max(2, Wd * 0.03);
          e.beginPath(); e.moveTo(-Wd / 2, 0); e.bezierCurveTo(-Wd * 0.2, Wd * 0.03, Wd * 0.2, Wd * 0.03, Wd / 2, 0); e.stroke();
          e.restore();
        }
      }
      // Inside the pupil: the prompt itself, on the eye's own dark, edged by the iris.
      if (inside > 0.001) {
        e.save();
        e.globalAlpha = inside;
        const pb = e.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
        pb.addColorStop(0, '#040102'); pb.addColorStop(0.75, '#0b0206'); pb.addColorStop(0.92, '#3a0b26'); pb.addColorStop(1, '#7a1d52');
        e.fillStyle = pb;
        e.fillRect(0, 0, W, H);
        const wl = e.createRadialGradient(W * 0.3, H * 0.22, 0, W * 0.3, H * 0.22, W * 0.32);
        wl.addColorStop(0, 'rgba(255,255,255,0.07)'); wl.addColorStop(1, 'rgba(255,255,255,0)');
        e.fillStyle = wl; e.fillRect(0, 0, W, H);
        const em = 44; const lh = 64; const x = 276; let y = info.answered ? 420 : 276;
        const lines = info.answered
          ? [['⏺Bash(pnpm prisma migrate dev)', 1], ['⎿Applied migration 20261022_add_session', 0.6], ['⏺Bash(pnpm test auth)', 1], ['⎿24 passed (1.8s)', 0.6]]
          : [[' Bash command', 0.6], ['', 0], ['   pnpm prisma migrate dev', 1], ['   Apply the Session migration to the dev database', 0.55], ['', 0],
            [' Do you want to proceed?', 1], [' ❯ 1. Yes', 1], ['   2. Yes, and don’t ask again for pnpm prisma migrate', 0.55], ['   3. No, and tell Claude what to do differently (esc)', 0.55]];
        const shown = info.answered ? info.answerLines : lines.length;
        lines.slice(0, shown).forEach(([s, b], j) => {
          if (!s) { y += lh; return; }
          const isYes = s.indexOf('❯') >= 0;
          if (isYes && info.flash > 0) {
            e.font = `500 ${em}px ${MONO}`;
            e.fillStyle = `rgba(233,228,216,${info.flash})`;
            e.fillRect(x - 10, y - lh / 2 + 4, e.measureText(s).width + 20, lh - 8);
          }
          const c = Math.round(233 * b);
          const col = isYes && info.flash > 0 ? '#050505' : `rgb(${c},${Math.round(228 * b)},${Math.round(216 * b)})`;
          if (s[0] === '⏺') {
            e.fillStyle = col; e.beginPath(); e.arc(x + em * 0.3, y, em * 0.24, 0, TAU); e.fill();
            termLine(e, s, x + em * 0.9, y, em, 1400, col);
          } else if (s[0] === '⎿') {
            termLine(e, s, x + em * 0.6, y, em, 1400, col);
          } else {
            e.font = `500 ${em}px ${MONO}`; e.textBaseline = 'middle'; e.textAlign = 'left'; e.fillStyle = col;
            e.fillText(s, x, y);
          }
          y += lh;
        });
        e.restore();
      }
    }

    function render(t) {
      cam = camAt(t);
      F = F0 * cam.zoom;
      cr = Math.cos(cam.roll); sr = Math.sin(cam.roll);
      // How much of the surface light reaches us.
      const depth = t < K.rise ? lerp(0.3, 1, smooth(ramp(t, 0, 9.6))) : lerp(1, 0, smooth(ramp(t, K.rise + 2, K.line0)));
      const keyI = 0.2 + 1.0 * (1 - depth);
      const eyeO = t < K.eye ? 0 : t < K.shut ? expoOut(ramp(t, K.eye, K.eye + 0.45)) * (1 - 0.06 * Math.sin(ramp(t, K.eye, K.shut) * 31) * ramp(t, K.eye + 0.5, K.eye + 0.9)) : 1 - ramp(t, K.shut, K.shut + 0.14);
      const info = {
        eyeO: Math.max(0, eyeO),
        scar: t >= K.shut ? 1 - ramp(t, K.shut + 0.3, K.shut + 2.0) : 0,
        inside: t < K.out0 ? ramp(t, K.cmdJ + 0.55, K.diveIn) : 1 - ramp(t, K.out0, K.out0 + 0.22),
        answered: t >= K.answer + 0.12,
        answerLines: Math.min(4, 1 + Math.floor((t - K.answer - 0.12) / 0.2)),
        flash: t >= K.answer && t < K.answer + 0.12 ? 1 : 0,
        dilate: 1 + 0.35 * smooth(ramp(t, K.cmdJ, K.cmdJ + 0.5)),
        look: Math.sin(t * 0.7) * (t < K.cmdJ ? 1 : 0),
        light: 1 + 0.2 * pulse(t),
        mainLabel: Math.max(ramp(t, 3.4, 4.2) * (1 - ramp(t, 12.4, 13.2)), ramp(t, 26.0, 26.8) * (1 - ramp(t, K.rise + 1, K.rise + 2))),
        sigil: smooth(ramp(t, K.rise + 1.2, K.couplet + 0.6)),
        label: 0,
        stuck: t < K.freeze0 ? 0 : ramp(t, K.freeze0, K.freeze1) * (1 - ramp(t, K.eye + 0.2, K.eye + 0.5)),
        out: {}
      };
      g.clearRect(0, 0, W, H);
      mt.clearRect(0, 0, W, H);
      // Everything sorted far to near.
      const items = [];
      const spineDz = 0 - cam.z;
      items.push({ dz: spineDz + 1, draw: () => drawSpine(t, info) });
      if (cam.y - 1400 < HEAD.y + HEAD.r * 1.3 + riseY(t)) {
        items.push({ dz: spineDz - 1, draw: () => drawHead(t, info) });
        items.push({ dz: spineDz + 0.5, draw: () => drawFace(t, info) });
      }
      let geo0 = null;
      ARMS.forEach((a, i) => {
        const geo = armGeom(i, t);
        if (i === 0) geo0 = geo;
        if (!geo) return;
        let sum = 0; let n = 0;
        geo.pts.forEach((p, k) => { if (k % 6 === 0) { sum += p[2] - cam.z; n++; } });
        const label = i === 0 ? Math.max(ramp(t, 9.6, 10.0) * (1 - ramp(t, 14.4, 14.8)), ramp(t, 25.8, 26.4) * (1 - ramp(t, MERGE(i) - 0.2, MERGE(i)))) :
          Math.max(ramp(t, K.sprout[i] + 0.6, K.sprout[i] + 1.0) * (1 - ramp(t, 15.2, 15.8)), ramp(t, 25.8, 26.4) * (1 - ramp(t, MERGE(i) - 0.2, MERGE(i))));
        items.push({ dz: sum / n, draw: () => drawArm(i, t, geo, Object.assign(Object.create(info), { label })) });
      });
      items.sort((a, b) => b.dz - a.dz);
      items.forEach((it) => it.draw());
      drawEye(t, geo0, info);
      // The terminals' light, blurred, lights the flesh and the blood near it.
      sp.clearRect(0, 0, 480, 270);
      sp.filter = 'blur(12px)';
      sp.drawImage(cM, 0, 0, 480, 270);
      sp.globalCompositeOperation = 'lighter';
      sp.filter = 'blur(3px)';
      sp.globalAlpha = 0.6;
      sp.drawImage(cM, 0, 0, 480, 270);
      sp.globalAlpha = 1;
      sp.filter = 'none';
      sp.globalCompositeOperation = 'source-over';

      // Blood: the hook's bloom from one sucker, and the cloud round the eye.
      const bl = info.out.bloom;
      const b0 = bl && t < 7 ? [bl.x, bl.y, Math.max(60, (55 + 70 * t) * bl.s), (0.75 + 0.25 * ramp(t, 0, 1)) * (1 - ramp(t, 3.4, 6.5))] : [0, 0, 1, 0];
      const ea = info.eyeAt;
      const grow = smooth(ramp(t, K.blood0, K.cmdJ));
      const fade = 1 - ramp(t, K.shut + 0.4, K.merge0);
      let b1 = [0, 0, 1, 0];
      if (geo0 && t >= K.blood0 && t < K.merge0) {
        const A = at(geo0, S_EYE); const P = proj(A.p);
        if (P) {
          const wpx = 3.0 * A.r * P.s / Math.max(1, cam.zoom);
          b1 = [ea ? ea.x : P.x, (ea ? ea.y : P.y) + wpx * 0.1, wpx * (0.45 + 0.9 * grow), (0.3 + 0.7 * grow) * fade * (1 - ramp(cam.zoom, 1.05, 2.5))];
        }
      }

      const { gl, texs, U } = glx;
      [cG, cM, cE, cS].forEach((c, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texs[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      });
      gl.uniform2f(U.res, W, H);
      gl.uniform1f(U.time, t);
      gl.uniform1f(U.depth, depth);
      gl.uniform1f(U.keyI, keyI);
      gl.uniform1f(U.surf, smooth(ramp(t, K.flood0, K.line0)));
      gl.uniform1f(U.collapse, ramp(t, K.line0, K.end - 0.02));
      gl.uniform1f(U.inside, info.inside);
      gl.uniform1f(U.snowY, cam.y * 0.42);
      gl.uniform1f(U.focus, Math.max(200, -cam.z * 1.05));
      gl.uniform1f(U.sigil, info.sigil);
      gl.uniform4f(U.blood0, b0[0], b0[1], b0[2], b0[3]);
      gl.uniform4f(U.blood1, b1[0], b1[1], b1[2], b1[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return { eye: info.eyeAt || null };
    }

    return { render };
  }

  /** Calls fn(t) for every time the timeline is seeked to, through a setter GSAP writes. */
  function drive(tl, dur, fn) {
    const clock = { _t: 0 };
    Object.defineProperty(clock, 't', { get() { return this._t; }, set(x) { this._t = x; fn(x); } });
    tl.fromTo(clock, { t: 0 }, { t: dur, duration: dur, ease: 'none', immediateRender: true }, 0);
    fn(0);
    return clock;
  }
  function fonts(list) {
    return Promise.all(list.map((f) => document.fonts.load(f))).then(() => document.fonts.ready);
  }

  window.WaviAbyss = { create, drive, fonts, K, ramp };
})();
