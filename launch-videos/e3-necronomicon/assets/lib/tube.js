/* Film E3's copy of film D1's tube (launch-videos/d-signal-church/assets/lib/tube.js), plus `calm`: 0-1 scales the
   line tears and sync jitter down so small type on the end card stays legible.
   Film D's one material: the site's old-TV tube (site/src/scripts/crt.ts) as a seekable renderer.
   Every scene paints its picture into a 2D source canvas, then the tube shows it through scanlines, an aperture grille,
   misconverged guns, unstable sync, a tracking band, snow, dropouts, a barrel-curved glass and the warm-up line.
   Nothing here keeps a clock: render(t, u) draws the frame for time t, so seeking always gives the same picture. */
(function () {
  const VERT = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';

  const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D tex;
uniform vec2 res;
uniform float time;
uniform float power;
uniform float glitch;
uniform float snow;
uniform float roll;
uniform float invert;
uniform float curve;
uniform float ca0;
uniform float lineH;
uniform float bandAmp;
uniform float calm;

float h1(float n) { return fract(sin(n) * 43758.5453123); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float n1(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
vec3 tap(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(tex, uv).rgb;
}

void main() {
  // Curved glass: the picture bulges and the corners fall off into the bezel.
  vec2 q0 = v - 0.5;
  vec2 qc = q0 * (1.0 + curve * dot(q0 * 2.0, q0 * 2.0)) * (1.0 - curve * 0.35);
  vec2 g = qc + 0.5;
  if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Tube power: a dot widens into a line, the line opens into the picture (and back, for the switch-off).
  float pw = clamp(power, 0.0, 1.0);
  float sx = clamp(pw * 4.0, 0.0, 1.0);
  float sy = max(clamp((pw - 0.25) / 0.75, 0.0, 1.0), 0.004);
  vec2 q = g - 0.5;
  if (abs(q.x) > sx * 0.5 + 0.001 || abs(q.y) > sy * 0.5 + 0.004) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 uv = vec2(q.x / max(sx, 0.001), q.y / sy) + 0.5;
  float t = time;

  // Vertical hold slipping.
  uv.y = fract(uv.y + roll);

  // Horizontal sync: per-line jitter, a slow wave, a travelling tracking band and tears.
  float row = floor(uv.y * res.y / lineH);
  float j = (h2(vec2(row, floor(t * 24.0))) - 0.5) * (0.0018 + glitch * 0.004) * (1.0 - 0.8 * calm);
  j += sin(uv.y * 40.0 + t * 3.0) * 0.0006 + sin(uv.y * 7.0 - t * 1.3) * 0.0012;
  float by = 1.0 - fract(t * 0.11);
  float band = smoothstep(0.07, 0.0, abs(uv.y - by));
  j += band * (n1(uv.y * 160.0 + t * 40.0) - 0.5) * 0.05 * bandAmp;
  float seg = floor(uv.y * 18.0);
  float k = floor(t * 9.0);
  float tear = step(0.985 - glitch * 0.5, h2(vec2(seg, k)));
  j += tear * (h2(vec2(seg + 7.0, k)) - 0.5) * (0.04 + glitch * 0.3) * (1.0 - calm);
  uv.x += j;

  // Misconverged guns, phosphor bleed and a ghost echo.
  float ca = ca0 + glitch * 0.03 + band * 0.01 + 0.0015 * sin(t * 0.9);
  vec3 c;
  c.r = tap(uv + vec2(ca, 0.0)).r;
  c.g = tap(uv).g;
  c.b = tap(uv - vec2(ca, 0.0)).b;
  // (Offsets are smaller than the site's: at 1080 a 3 % vertical tap doubles every line of small type.)
  vec3 bl = (tap(uv + vec2(0.003, 0.0)) + tap(uv - vec2(0.003, 0.0)) + tap(uv + vec2(0.0, 0.005)) + tap(uv - vec2(0.0, 0.005))) * 0.25;
  c += bl * 0.3;
  c += tap(uv - vec2(0.012, 0.0)) * vec3(0.06, 0.10, 0.16);
  c = clamp(c, 0.0, 1.0);

  // Negative.
  c = mix(c, vec3(1.0) - c, invert);

  // Scanlines, aperture grille, hum bar, flicker.
  float sl = 0.58 + 0.42 * pow(abs(sin(gl_FragCoord.y * 3.14159 / lineH)), 2.0);
  c *= sl;
  float m = mod(gl_FragCoord.x, 3.0);
  c *= vec3(m < 1.0 ? 1.15 : 0.82, (m >= 1.0 && m < 2.0) ? 1.15 : 0.82, m >= 2.0 ? 1.15 : 0.82);
  c *= 0.9 + 0.14 * sin((g.y - t * 0.18) * 6.2832);
  c *= 0.9 + 0.12 * h1(floor(t * 30.0));

  // Snow and dropouts.
  float sn = h2(floor(gl_FragCoord.xy / 2.0) + vec2(fract(t * 0.37) * 971.0, fract(t * 0.23) * 577.0));
  float base = 0.04 + snow * 0.8 + band * 0.14 + glitch * 0.25;
  c += vec3(step(1.0 - base * 0.32, sn)) * (0.22 + snow * 0.6);
  c += (sn - 0.5) * base * 0.22;
  float dr = step(0.9975 - snow * 0.03, h2(vec2(floor(gl_FragCoord.y / 2.0), floor(t * 14.0)))) * (1.0 - 0.9 * calm);
  c += dr * 0.45;

  // The bright line while the tube warms up or dies.
  float warm = 1.0 - smoothstep(0.25, 0.7, pw);
  c += vec3(0.85, 0.92, 1.0) * warm * max(0.0, 1.4 - abs(q.y) / max(sy * 0.5, 0.001) * 1.2);

  // The glass falls off into the bezel.
  float ex = smoothstep(0.0, 0.035, g.x) * smoothstep(1.0, 0.965, g.x);
  float ey = smoothstep(0.0, 0.06, g.y) * smoothstep(1.0, 0.94, g.y);
  c *= ex * ey * (1.0 - 0.35 * dot(q0, q0));
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`;

  const DEFAULTS = { power: 1, glitch: 0, snow: 0.04, roll: 0, invert: 0, curve: 0.06, ca0: 0.0025, lineH: 4, bandAmp: 1, calm: 0 };
  const NAMES = ['res', 'time', 'power', 'glitch', 'snow', 'roll', 'invert', 'curve', 'ca0', 'lineH', 'bandAmp', 'calm'];

  function create(canvas, opts) {
    const o = opts || {};
    canvas.width = o.w || 1920;
    canvas.height = o.h || 1080;
    const src = document.createElement('canvas');
    src.width = o.srcW || canvas.width;
    src.height = o.srcH || canvas.height;
    const ctx = src.getContext('2d');
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('tube: WebGL unavailable');
    const compile = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('tube: ' + gl.getShaderInfoLog(s));
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
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const u = {};
    NAMES.forEach((n) => { u[n] = gl.getUniformLocation(prog, n); });
    gl.viewport(0, 0, canvas.width, canvas.height);

    return {
      src,
      ctx,
      W: src.width,
      H: src.height,
      /** Shows the source as it is now, at film time t, with the tube's settings u. */
      render(t, uu) {
        const p = Object.assign({}, DEFAULTS, uu || {});
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.uniform2f(u.res, canvas.width, canvas.height);
        gl.uniform1f(u.time, t);
        ['power', 'glitch', 'snow', 'roll', 'invert', 'curve', 'ca0', 'lineH', 'bandAmp', 'calm'].forEach((n) => gl.uniform1f(u[n], p[n]));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    };
  }

  /** Calls fn(t) for every time the timeline is seeked to, through a setter GSAP writes (callbacks may be suppressed). */
  function drive(tl, dur, fn) {
    const clock = { _t: 0 };
    Object.defineProperty(clock, 't', { get() { return this._t; }, set(x) { this._t = x; fn(x); } });
    tl.fromTo(clock, { t: 0 }, { t: dur, duration: dur, ease: 'none', immediateRender: true }, 0);
    fn(0);
    return clock;
  }

  /* ---- Pure helpers: everything is a function of t ---- */
  const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ramp = (t, a, b) => clamp01((t - a) / (b - a));
  /** 1 at t0, falling to 0 over d (power2.out); 0 before t0. */
  const decay = (t, t0, d) => (t < t0 ? 0 : Math.pow(1 - clamp01((t - t0) / d), 2));
  const frame = (t) => Math.floor(t * 30 + 1e-4);
  /** A channel change at t0: glitch and snow spike and settle, the picture rolls once. */
  function channel(t, t0, amount) {
    const a = amount == null ? 1 : amount;
    const r = t < t0 ? 0 : t > t0 + 0.42 ? 0 : (1 - Math.cos(Math.PI * (t - t0) / 0.42)) / 2;
    return { glitch: decay(t, t0, 0.45) * a, snow: decay(t, t0, 0.32) * 0.85 * a, roll: r };
  }
  /** Sum of several setting objects. */
  function mix() {
    const out = { glitch: 0, snow: 0, roll: 0 };
    for (const o of arguments) for (const k in o) out[k] = (out[k] || 0) + o[k];
    return out;
  }

  /* ---- Drawing helpers for the source canvas ---- */
  const GROT = '"Wavi Archivo", Archivo, sans-serif';
  const DIDONE = '"Wavi Bodoni", "Bodoni Moda", serif';
  const MONO = '"Wavi Mono", "JetBrains Mono", monospace';

  function text(ctx, s, x, y, o) {
    ctx.save();
    ctx.font = o.font;
    ctx.fontStretch = o.stretch || 'normal';
    ctx.letterSpacing = o.tracking || '0px';
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    ctx.fillStyle = o.fill || '#ededed';
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  /** The site's line-screen orbit (site/src/scripts/poster.ts): the Wavi mark as rows of lines whose thickness is its luminance. */
  function orbit(W, H, opts) {
    const o = opts || {};
    const ORB = window.WAVI_ORBIT;
    const path = new Path2D(ORB.d);
    const VB = { x: ORB.viewBox[0], y: ORB.viewBox[1], w: ORB.viewBox[2], h: ORB.viewBox[3] };
    const MW = Math.round(W / 2);
    const MH = Math.round(H / 2);
    const off = document.createElement('canvas');
    off.width = MW;
    off.height = MH;
    const x = off.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000';
    x.fillRect(0, 0, MW, MH);
    const s = Math.min(MW / VB.w, MH / VB.h) * (o.size || 0.82);
    const place = () => {
      x.translate(MW * (o.cx || 0.5), MH * (o.cy || 0.5));
      x.scale(s, s);
      x.translate(-(VB.x + VB.w / 2), -(VB.y + VB.h / 2));
    };
    x.save(); place();
    x.filter = 'blur(' + Math.round(MW * 0.035) + 'px)';
    x.fillStyle = 'rgba(255,255,255,0.42)';
    x.fill(path, 'evenodd');
    x.restore();
    x.save(); place();
    const g = x.createRadialGradient(470, 420, 10, 512, 512, 430);
    g.addColorStop(0, '#fff'); g.addColorStop(0.55, '#cfcfcf'); g.addColorStop(1, '#5a5a5a');
    x.fillStyle = g;
    x.fill(path, 'evenodd');
    x.restore();
    const d = x.getImageData(0, 0, MW, MH).data;
    const map = new Float32Array(MW * MH);
    for (let i = 0; i < map.length; i++) { const j = i * 4; map[i] = (d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) / 255; }
    const smooth = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };

    /** p: { t, spin, reveal (0..1 sweep from the left), amp (row lift), ink } */
    return function paint(ctx, p) {
      const ang = -0.14 + Math.sin(p.t * 0.16) * 0.1 + (p.spin || 0);
      const cos = Math.cos(-ang); const sin = Math.sin(-ang);
      const cxm = W / 2; const cym = H / 2;
      const lum = (px, py) => {
        const dx = px - cxm; const dy = py - cym;
        const rx = ((cos * dx - sin * dy + cxm) / 2) | 0;
        const ry = ((sin * dx + cos * dy + cym) / 2) | 0;
        if (rx < 0 || ry < 0 || rx >= MW || ry >= MH) return 0;
        return map[ry * MW + rx];
      };
      const gap = Math.max(6, H / (o.rows || 78));
      const step = Math.max(2, Math.round(gap / 4));
      const amp = p.amp == null ? 0.6 : p.amp;
      const revealX = (p.reveal == null ? 1 : p.reveal) * (W + 240) - 120;
      ctx.fillStyle = p.ink || '#fff';
      for (let y0 = gap / 2; y0 < H + gap; y0 += gap) {
        const top = []; const bot = [];
        for (let px = 0; px <= W + step; px += step) {
          let vv = smooth(0.06, 0.9, (lum(px, y0 - gap * 0.33) + lum(px, y0) + lum(px, y0 + gap * 0.33)) / 3);
          vv *= smooth(revealX, revealX - 160, px);
          const yc = y0 - vv * gap * amp + Math.sin(px / W * 9 + y0 / H * 5 + p.t * 1.1) * gap * 0.12;
          const th = vv * gap * 0.96;
          top.push(px, yc - th / 2); bot.push(px, yc + th / 2);
        }
        ctx.beginPath();
        ctx.moveTo(top[0], top[1]);
        for (let i = 2; i < top.length; i += 2) ctx.lineTo(top[i], top[i + 1]);
        for (let i = bot.length - 2; i >= 0; i -= 2) ctx.lineTo(bot[i], bot[i + 1]);
        ctx.closePath();
        ctx.fill();
      }
    };
  }

  /** Waits for the faces a scene paints with. */
  function fonts(list) {
    return Promise.all(list.map((f) => document.fonts.load(f))).then(() => document.fonts.ready);
  }
  function image(src) {
    const img = new Image();
    img.src = src;
    return img.decode().then(() => img);
  }

  window.WaviTube = { create, drive, hash, clamp01, ramp, decay, frame, channel, mix, text, orbit, fonts, image, GROT, DIDONE, MONO };
})();
