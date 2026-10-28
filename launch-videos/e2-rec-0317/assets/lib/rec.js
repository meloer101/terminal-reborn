/* Film E2's one material: a recording played back off tape.
   A scene paints its picture into two 2D canvases every frame: `ui` (the screen) and `blood` (a white field whose
   value is the blood's thickness). One WebGL pass is the camcorder: the green grade on the UI, the blood shaded as a
   liquid over it (the only red in the film), then grain, interlace, chroma offset, autofocus blur, line jitter, the
   head-switching band and, for the rewind, tear bands. A third 2D canvas is the camcorder's OSD, never graded.
   Nothing here keeps a clock: render(t, p) draws the frame for time t, so seeking always gives the same picture. */
(function () {
  const VERT = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';

  const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D uUi;
uniform sampler2D uBl;
uniform vec2 res;
uniform float time;
uniform float grade;
uniform float keepM;
uniform float keepB;
uniform float rew;
uniform float grain;
uniform float focus;
uniform float jitter;
uniform float gain;
uniform float bloodOn;
uniform float power;
uniform float vig;
uniform float hsw;

float h1(float n) { return fract(sin(n) * 43758.5453123); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }

vec3 uiAt(vec2 uv) { return texture2D(uUi, uv).rgb; }
vec3 uiSoft(vec2 uv) {
  if (focus < 0.05) return uiAt(uv);
  vec2 d = focus / res;
  vec3 s = uiAt(uv) * 0.2;
  s += (uiAt(uv + vec2(d.x, 0.0)) + uiAt(uv - vec2(d.x, 0.0)) + uiAt(uv + vec2(0.0, d.y)) + uiAt(uv - vec2(0.0, d.y))) * 0.12;
  s += (uiAt(uv + d * 0.7) + uiAt(uv - d * 0.7) + uiAt(uv + vec2(d.x, -d.y) * 0.7) + uiAt(uv + vec2(-d.x, d.y) * 0.7)) * 0.08;
  return s;
}
// The camcorder's green: luma to black-green, mid green, pale green-white. Wavi's magenta and running blue pass through.
vec3 gradeIt(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 lo = vec3(0.020, 0.067, 0.035);
  vec3 mid = vec3(0.29, 0.55, 0.32);
  vec3 hi = vec3(0.88, 1.0, 0.85);
  vec3 g = l < 0.5 ? mix(lo, mid, l * 2.0) : mix(mid, hi, (l - 0.5) * 2.0);
  float m = smoothstep(0.28, 0.5, c.r - c.g) * smoothstep(0.12, 0.28, c.b - c.g);
  float b = smoothstep(0.2, 0.4, c.b - c.r);
  float k = grade * (1.0 - m * keepM) * (1.0 - b * keepB);
  return mix(c, g, k);
}
float fld(vec2 uv) { return texture2D(uBl, uv).r; }
vec3 scene(vec2 uv) {
  vec3 base = gradeIt(uiSoft(uv));
  if (bloodOn < 0.5) return base;
  float f = fld(uv);
  float a = smoothstep(0.40, 0.56, f);
  if (a <= 0.0) return base;
  vec2 px = 1.0 / res;
  vec2 e = px * 2.5;
  float fx = fld(uv + vec2(e.x, 0.0)) - fld(uv - vec2(e.x, 0.0));
  float fy = fld(uv + vec2(0.0, e.y)) - fld(uv - vec2(0.0, e.y));
  float h = clamp((f - 0.5) * 2.2, 0.0, 1.0);
  vec3 n = normalize(vec3(-fx * 3.2, -fy * 3.2, 1.0));
  vec2 q = uv * vec2(res.x / res.y, 1.0) * 5.0;
  n = normalize(n + vec3(vn(q + time * 0.12) - 0.5, vn(q * 1.3 - time * 0.09) - 0.5, 0.0) * 0.3 * h);
  // Deep blood moves as one body: broad, slow swells catch the light.
  n = normalize(n + vec3(vn(q * 0.32 + vec2(time * 0.21, 0.0)) - 0.5, vn(q * 0.27 + vec2(3.1, -time * 0.17)) - 0.5, 0.0) * 1.3 * h);
  vec3 L = normalize(vec3(-0.45, 0.62, 0.65));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 r = reflect(-L, n);
  float spec = pow(max(r.z, 0.0), 48.0);
  float sheen = pow(max(r.z, 0.0), 10.0) * 0.22 + pow(max(r.z, 0.0), 22.0) * 0.35 * h;
  vec3 under = gradeIt(uiAt(uv + n.xy * 6.0 * px));
  float ul = dot(under, vec3(0.3, 0.59, 0.11));
  vec3 col = mix(vec3(0.88, 0.06, 0.09), vec3(0.52, 0.012, 0.04), smoothstep(0.0, 0.9, h));
  float clot = smoothstep(0.64, 0.86, fbm(uv * vec2(res.x / res.y, 1.0) * 9.0 + vec2(0.0, time * 0.02))) * smoothstep(0.3, 0.9, h);
  col = mix(col, vec3(0.16, 0.008, 0.02), clot * 0.7);
  col += vec3(0.5, 0.02, 0.03) * ul * (1.0 - h) * 0.7;
  col *= 0.7 + 0.45 * diff;
  float rim = 1.0 - smoothstep(0.5, 0.64, f);
  col *= 1.0 - rim * 0.5;
  col += vec3(1.0, 0.86, 0.86) * spec * 0.85 + vec3(0.6, 0.2, 0.2) * sheen;
  return mix(base, col, a);
}

void main() {
  vec2 uv = v;
  // Tape stop: the picture collapses to a line.
  float pw = clamp(power, 0.0, 1.0);
  if (pw < 1.0) {
    float sy = max((pw - 0.15) / 0.85, 0.004);
    float sx = clamp(pw * 6.0, 0.0, 1.0);
    vec2 q = uv - 0.5;
    if (abs(q.y) > sy * 0.5 || abs(q.x) > sx * 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    uv = vec2(q.x / max(sx, 0.001), q.y / sy) + 0.5;
  }
  float yPix = (1.0 - uv.y) * res.y;
  float row = floor(yPix);
  float fr = floor(time * 30.0 + 0.001);
  float dx = (h2(vec2(row * 0.37, fr)) - 0.5) * jitter;
  float bar = 0.0;
  if (rew > 0.0) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float c = fract(h1(fi * 7.1 + 1.0) + time * (0.9 + fi * 0.53));
      float w = 0.02 + 0.035 * h1(fi * 3.3 + 2.0);
      float band = smoothstep(w, 0.0, abs((1.0 - uv.y) - c));
      dx += band * (18.0 + 22.0 * h1(fi + fr * 0.13)) * rew;
      bar = max(bar, band * rew);
    }
    dx += sin(uv.y * 30.0 + time * 40.0) * 5.0 * rew;
  }
  float hsBand = smoothstep(res.y - 15.0, res.y - 6.0, yPix) * hsw;
  dx += hsBand * (24.0 + 16.0 * h2(vec2(row, fr)));
  uv.x += dx / res.x;
  vec3 c;
  c.r = scene(uv + vec2(2.0 / res.x, 0.0)).r;
  c.gb = scene(uv).gb;
  float nz = h2(gl_FragCoord.xy * 1.3 + vec2(fr * 17.0, fr * 3.0));
  c = mix(c, vec3(nz * 0.85), bar * 0.55);
  c = mix(c, vec3(nz * 0.6), hsBand * 0.5);
  c += (nz - 0.5) * grain;
  c *= 1.0 - 0.05 * mod(row, 2.0);
  c *= gain;
  vec2 vq = (v - 0.5) * vec2(1.15, 1.0);
  c *= 1.0 - vig * pow(clamp(length(vq) * 1.35, 0.0, 1.0), 2.4);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  const DEFAULTS = { grade: 0.88, keepM: 0, keepB: 0, rew: 0, grain: 0.07, focus: 0, jitter: 0.6, gain: 1, bloodOn: 1, power: 1, vig: 0.3, hsw: 1 };
  const NAMES = Object.keys(DEFAULTS);

  function create(canvas, osdCanvas) {
    canvas.width = 1920;
    canvas.height = 1080;
    const ui = document.createElement('canvas');
    ui.width = 1920; ui.height = 1080;
    const bl = document.createElement('canvas');
    bl.width = 1920; bl.height = 1080;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const tex = (unit) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const tUi = tex(0);
    const tBl = tex(1);
    const u = {};
    NAMES.concat(['res', 'time', 'uUi', 'uBl']).forEach((n) => { u[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(u.uUi, 0);
    gl.uniform1i(u.uBl, 1);
    gl.viewport(0, 0, 1920, 1080);
    const osd = osdCanvas ? osdCanvas.getContext('2d') : null;
    if (osdCanvas) { osdCanvas.width = 1920; osdCanvas.height = 1080; }
    return {
      ui: ui.getContext('2d'),
      blood: bl.getContext('2d'),
      osd,
      W: 1920,
      H: 1080,
      /** Clears both paint canvases and leaves them in screen space. */
      begin(ground) {
        const a = this.ui; const b = this.blood;
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.globalAlpha = 1;
        a.fillStyle = ground || '#050505';
        a.fillRect(0, 0, 1920, 1080);
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.globalCompositeOperation = 'source-over';
        b.globalAlpha = 1;
        b.fillStyle = '#000';
        b.fillRect(0, 0, 1920, 1080);
        if (osd) osd.clearRect(0, 0, 1920, 1080);
      },
      /** Shows the painted frame at time t through the camcorder with settings p. */
      render(t, p) {
        const q = Object.assign({}, DEFAULTS, p || {});
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tUi);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ui);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tBl);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bl);
        gl.uniform2f(u.res, 1920, 1080);
        gl.uniform1f(u.time, t);
        NAMES.forEach((n) => gl.uniform1f(u[n], q[n]));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    };
  }

  /** Calls fn(t) for every time the timeline is seeked to, through a setter GSAP writes. */
  function drive(tl, dur, fn) {
    const clock = { _t: 0 };
    Object.defineProperty(clock, 't', { get() { return this._t; }, set(x) { this._t = x; fn(x); } });
    tl.fromTo(clock, { t: 0 }, { t: dur, duration: dur, ease: 'none', immediateRender: true }, 0);
    fn(0);
    return clock;
  }

  /* ---- Pure helpers ---- */
  const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ramp = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const io3 = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const out3 = (k) => 1 - Math.pow(1 - k, 3);
  const in2 = (k) => k * k;
  const smooth = (k) => k * k * (3 - 2 * k);
  /** A sin bump over [t0, t0 + d]: 0 -> 1 -> 0. */
  const bump = (t, t0, d) => (t < t0 || t > t0 + d ? 0 : Math.sin(Math.PI * (t - t0) / d));

  /** Camera keys [{t, s, x, y}] (world point at the frame centre, scale) eased with io3 over `d` after each key. */
  function camera(keys, t, d) {
    let cur = keys[0];
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      if (t < k.t) break;
      const dur = k.d || d;
      const e = io3(clamp01((t - k.t) / dur));
      cur = { s: lerp(cur.s, k.s, e), x: lerp(cur.x, k.x, e), y: lerp(cur.y, k.y, e) };
      if (t < k.t + dur) return cur;
      cur = { s: k.s, x: k.x, y: k.y };
    }
    return cur;
  }
  /** Sets a canvas transform so world point (cam.x, cam.y) sits at the frame centre at scale cam.s, plus handheld drift. */
  function apply(ctx, cam, t, shake) {
    const k = shake == null ? 1 : shake;
    const hx = (2.2 * Math.sin(t * 0.9) + 1.3 * Math.sin(t * 2.3 + 1.0)) * k;
    const hy = (1.8 * Math.sin(t * 0.7 + 2.0) + 1.1 * Math.sin(t * 1.9 + 0.4)) * k;
    ctx.setTransform(cam.s, 0, 0, cam.s, 960 - cam.x * cam.s + hx, 540 - cam.y * cam.s + hy);
  }

  /* ---- Type ---- */
  const MONO = '"Wavi Mono", "JetBrains Mono", Menlo, monospace';
  const SANS = '"Wavi Archivo", Archivo, Inter, sans-serif';
  const SERIF = '"Wavi Bodoni", "Bodoni Moda", serif';
  const KEYS = 'Inter, "Wavi Archivo", sans-serif';
  /** Terminal colours (a-waiting's rebuild of the app's terminal palette). */
  const C = { g: '#3dd68c', w: '#ededed', n: '#c4c4c4', d: '#808080', o: '#e08a5e', v: '#c79bff', b: '#5ea1ff', m: '#ff5fb0', k: '#5a5a5a' };
  /** Parses "{g}⏺ {w}Read{n}(x)" into [[colour, text], ...]. */
  function spans(s) {
    const out = [];
    const re = /\{(\w)\}/g;
    let last = 0; let col = 'n'; let m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push([col, s.slice(last, m.index)]);
      col = m[1];
      last = re.lastIndex;
    }
    if (last < s.length) out.push([col, s.slice(last)]);
    return out;
  }
  const plain = (s) => s.replace(/\{\w\}/g, '');

  function text(ctx, s, x, y, o) {
    ctx.save();
    ctx.font = o.font;
    if (o.stretch) ctx.fontStretch = o.stretch;
    ctx.letterSpacing = o.tracking || '0px';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    ctx.fillStyle = o.fill || '#ededed';
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  /* ---- The camcorder OSD (white, outlined, never graded) ---- */
  function osdText(ctx, s, x, y, size, align, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.font = '700 ' + size + 'px ' + MONO;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = Math.round(size * 0.06) + 'px';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.11);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = '#f2f2ec';
    ctx.fillText(s, x, y);
    ctx.restore();
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  /** Seconds after midnight -> "03:17:06 AM". */
  function clock(sec) {
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600) % 24;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return pad2(h12) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60) + (h < 12 ? ' AM' : ' PM');
  }
  /** st: { mode: 'rec' | 'rew' | 'play', t (film s), clock (s after midnight), date, alpha } */
  function osd(ctx, st) {
    if (!ctx) return;
    const a = st.alpha == null ? 1 : st.alpha;
    if (a <= 0) return;
    const L = 120; const R = 1800; const T = 118; const B = 990;
    if (st.mode === 'rec') {
      const on = Math.floor(st.t) % 2 === 0;
      ctx.save();
      ctx.globalAlpha = a * (on ? 1 : 0.0);
      ctx.beginPath(); ctx.arc(L + 14, T - 13, 13, 0, Math.PI * 2);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke();
      ctx.fillStyle = '#f2f2ec'; ctx.fill();
      ctx.restore();
      osdText(ctx, 'REC', L + 42, T, 40, 'left', a);
    } else if (st.mode === 'rew') {
      osdText(ctx, '◀◀ REW', L, T, 40, 'left', a);
    } else if (st.mode === 'play') {
      osdText(ctx, '▶ PLAY', L, T, 40, 'left', a);
    }
    // Battery: a cell outline with three of four bars.
    ctx.save();
    ctx.globalAlpha = a;
    const bx = R - 92; const by = T - 32;
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeRect(bx, by, 80, 34); ctx.strokeRect(bx + 80, by + 10, 8, 14);
    ctx.lineWidth = 3; ctx.strokeStyle = '#f2f2ec';
    ctx.strokeRect(bx, by, 80, 34); ctx.fillStyle = '#f2f2ec'; ctx.fillRect(bx + 80, by + 10, 8, 14);
    for (let i = 0; i < 3; i++) ctx.fillRect(bx + 7 + i * 18, by + 7, 13, 20);
    ctx.restore();
    osdText(ctx, 'SP', R - 120, T, 34, 'right', a);
    osdText(ctx, st.date || 'OCT 24 2026', L, B, 34, 'left', a);
    osdText(ctx, clock(st.clock), R, B, 34, 'right', a);
  }

  /** Waits for the faces a scene paints with. */
  function fonts(list) {
    return Promise.all(list.map((f) => document.fonts.load(f).catch(() => null))).then(() => document.fonts.ready);
  }
  function image(src) {
    const img = new Image();
    img.src = src;
    return img.decode().then(() => img);
  }

  window.Rec = {
    create, drive, hash, clamp01, ramp, lerp, io3, out3, in2, smooth, bump, camera, apply,
    MONO, SANS, SERIF, KEYS, C, spans, plain, text, osd, osdText, clock, fonts, image
  };
})();
