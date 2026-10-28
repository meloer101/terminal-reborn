/* Film E3's pages: every engraving, rule, seal, eye and the flesh of the binding, drawn procedurally into Folio sheets.
   Coordinates are page-texture pixels (Folio.TEX_W x Folio.TEX_H, the far edge at the top). Every painter is a pure
   function of its arguments (seeded randomness only), so a page repainted for a frame is always the same page. */
(function () {
  const F = window.Folio;
  const { MAT, mulberry32, clamp01, lerp, ramp, E } = F;
  const PW = F.TEX_W; const PH = F.TEX_H;
  const FRAK = '"Wavi Fraktur", serif';
  const BOD = '"Wavi Bodoni", serif';
  const ITAL = '"Wavi Bodoni Italic", serif';
  const BLOOD = { deep: '#5c0000', mid: '#7a0000', lit: '#a80808', thin: '#d10f0f' };
  const MAGENTA = '#ff5fb0';

  /* ---------- type ---------- */
  /** Text that takes the ink: a in 0..1 → opacity and a 6 px blur that clears. */
  function inkText(sh, s, x, y, o) {
    const a = o.a == null ? 1 : o.a;
    if (a <= 0) return;
    const m = Object.assign({}, o.mat || MAT.ink, { alpha: a, blurC: (1 - a) * 6, blurH: (1 - a) * 6 });
    sh.layer(m, (c) => {
      c.font = o.font; c.textAlign = o.align || 'center'; c.textBaseline = o.baseline || 'alphabetic';
      c.letterSpacing = o.tracking || '0px';
      if (o.cmd) cmdText(c, s, x, y, o); else c.fillText(s, x, y);
    });
  }
  /** Lays out a string that contains ⌘: the glyph is drawn as a path in the run's colour. */
  function cmdText(c, s, x, y, o) {
    const parts = s.split('⌘');
    const size = parseFloat(/(\d+(\.\d+)?)px/.exec(o.font)[1]);
    const gw = size * 0.78;
    let total = 0;
    parts.forEach((p, i) => { total += c.measureText(p).width; if (i < parts.length - 1) total += gw + size * 0.08; });
    const align = c.textAlign;
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    c.textAlign = 'left';
    parts.forEach((p, i) => {
      c.fillText(p, cx, y); cx += c.measureText(p).width;
      if (i < parts.length - 1) {
        cmdGlyph(c, cx + size * 0.04 + gw / 2, y - size * 0.33, gw * 0.5, size * (o.cmdWeight || 0.075));
        cx += gw + size * 0.08;
      }
    });
    c.textAlign = align;
  }
  /** ⌘ (place of interest): a square whose sides run on into four outer loops. r = half size. */
  function cmdGlyph(c, x, y, r, lw) {
    const a = r * 0.36; const lr = (r - a) * 0.5; const L = a + lr;
    c.save();
    c.lineWidth = lw; c.lineCap = 'butt'; c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(-a + x, -L + y); c.lineTo(-a + x, L + y);
    c.moveTo(a + x, -L + y); c.lineTo(a + x, L + y);
    c.moveTo(-L + x, -a + y); c.lineTo(L + x, -a + y);
    c.moveTo(-L + x, a + y); c.lineTo(L + x, a + y);
    c.stroke();
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy]) => {
      // the loop is the 3/4 of the circle outside the square: skip the quarter that faces the centre
      const cd = Math.atan2(-sy, -sx);
      c.beginPath(); c.arc(x + sx * L, y + sy * L, lr, cd + Math.PI / 4, cd + (7 * Math.PI) / 4); c.stroke();
    });
    c.restore();
  }
  /** A blackletter rule; its first letter is a rubricated versal in blood, 1.35x the line, sunk below it. */
  function rule(sh, lines, x, y, size, o) {
    const oo = o || {};
    const lead = size * (oo.lead || 1.12);
    lines.forEach((ln, i) => {
      const a = oo.a ? oo.a[i] : 1;
      if (a <= 0) return;
      const yy = y + i * lead;
      const font = size + 'px ' + FRAK;
      if (i === 0 && oo.versal !== false) {
        const head = ln[0]; const rest = ln.slice(1);
        const vs = size * 1.35;
        sh.c.save(); sh.c.font = font; const wRest = sh.c.measureText(rest).width; sh.c.font = vs + 'px ' + FRAK; const wHead = sh.c.measureText(head).width; sh.c.restore();
        const total = wHead + wRest;
        const x0 = oo.align === 'left' ? x : x - total / 2;
        inkText(sh, head, x0, yy + size * 0.12, { font: vs + 'px ' + FRAK, align: 'left', a, mat: MAT.blood });
        inkText(sh, rest, x0 + wHead, yy, { font, align: 'left', a, cmd: oo.cmd });
      } else {
        inkText(sh, ln, x, yy, { font, align: oo.align || 'center', a, cmd: oo.cmd });
      }
    });
  }
  function caps(sh, s, x, y, size, a, o) {
    inkText(sh, s, x, y, Object.assign({ font: '600 ' + size + 'px ' + BOD, tracking: (size * 0.12).toFixed(1) + 'px', a }, o || {}));
  }
  function ital(sh, s, x, y, size, a, o) {
    inkText(sh, s, x, y, Object.assign({ font: '500 ' + size + 'px ' + ITAL, a }, o || {}));
  }

  /* ---------- line art ---------- */
  function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
  function bez(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; const u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
    return out;
  }
  /** Strokes the first k (0..1) of a polyline. */
  function strokePart(c, pts, k) {
    if (k <= 0) return;
    const L = polyLen(pts) * Math.min(1, k);
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + d >= L) { const f = (L - acc) / d; c.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)); break; }
      acc += d; c.lineTo(pts[i][0], pts[i][1]);
    }
    c.stroke();
  }
  /** Parallel hatching clipped to a path: angle in rad, pitch px, line width. */
  function hatch(c, clip, ang, pitch, lw, box, wob) {
    c.save();
    c.beginPath(); clip(c); c.clip();
    const [x0, y0, x1, y1] = box || [0, 0, PW, PH];
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const R = Math.hypot(x1 - x0, y1 - y0) / 2 + pitch;
    const dx = Math.cos(ang); const dy = Math.sin(ang);
    c.lineWidth = lw;
    c.beginPath();
    for (let d = -R; d <= R; d += pitch) {
      const px = cx - dy * d; const py = cy + dx * d;
      if (wob) {
        const n = 24;
        for (let i = 0; i <= n; i++) {
          const s = -R + (2 * R * i) / n;
          const w = Math.sin(s * 0.03 + d * 0.11) * wob;
          const X = px + dx * s - dy * w; const Y = py + dy * s + dx * w;
          if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
        }
      } else {
        c.moveTo(px - dx * R, py - dy * R); c.lineTo(px + dx * R, py + dy * R);
      }
    }
    c.stroke();
    c.restore();
  }
  /** A tapered tube along a centre line: contours, shadow-side hatching across it, rings, suckers. k reveals it. */
  function tube(c, pts, wFn, k, o) {
    const oo = o || {};
    const n = pts.length;
    const upto = Math.floor((n - 1) * clamp01(k));
    if (upto < 1) return;
    const L = []; const R = []; const N = [];
    for (let i = 0; i <= upto; i++) {
      const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
      let nx = -(b[1] - a[1]); let ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const w = wFn(i / (n - 1));
      N.push([nx, ny, w]);
      L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); R.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    // hatching across the tube on the side away from the light (light from the left: -x)
    c.lineWidth = oo.hlw || 1.6;
    c.beginPath();
    const step = oo.step || 2;
    for (let i = 0; i <= upto; i += step) {
      const [nx, ny, w] = N[i];
      const away = nx > 0 ? 1 : -1; // the side whose normal points +x is in shadow
      const f = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(i * 0.9));
      const sx = pts[i][0] + nx * w * away; const sy = pts[i][1] + ny * w * away;
      c.moveTo(sx, sy); c.lineTo(sx - nx * w * away * 2 * f, sy - ny * w * away * 2 * f);
    }
    c.stroke();
    if (oo.rings) {
      c.lineWidth = oo.rlw || 1.4;
      c.beginPath();
      for (let i = oo.rings; i <= upto; i += oo.rings) {
        const [nx, ny, w] = N[i];
        c.moveTo(pts[i][0] + nx * w, pts[i][1] + ny * w);
        c.quadraticCurveTo(pts[i][0] + (pts[Math.min(n - 1, i + 1)][0] - pts[i][0]) * 1.5, pts[i][1] + (pts[Math.min(n - 1, i + 1)][1] - pts[i][1]) * 1.5, pts[i][0] - nx * w, pts[i][1] - ny * w);
      }
      c.stroke();
    }
    if (oo.suckers) {
      c.lineWidth = 1.5;
      for (let i = oo.suckers; i <= upto; i += oo.suckers) {
        const [nx, ny, w] = N[i];
        const sd = oo.suckerSide || -1;
        const sx = pts[i][0] + nx * w * 0.55 * sd; const sy = pts[i][1] + ny * w * 0.55 * sd;
        c.beginPath(); c.ellipse(sx, sy, w * 0.32, w * 0.22, Math.atan2(ny, nx), 0, Math.PI * 2); c.stroke();
      }
    }
    c.lineWidth = oo.clw || 3;
    c.beginPath(); L.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
    c.beginPath(); R.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
  }
  /** A double engraved border: outer heavy rule, inner hairline. */
  function frameRect(sh, x, y, w, h, a) {
    sh.layer(Object.assign({}, MAT.ink, { alpha: a == null ? 1 : a }), (c) => {
      c.lineWidth = 5; c.strokeRect(x, y, w, h);
      c.lineWidth = 1.6; c.strokeRect(x + 16, y + 16, w - 32, h - 32);
    });
  }
  function frameOval(sh, cx, cy, rx, ry, a) {
    sh.layer(Object.assign({}, MAT.ink, { alpha: a == null ? 1 : a }), (c) => {
      c.lineWidth = 5; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 1.6; c.beginPath(); c.ellipse(cx, cy, rx - 16, ry - 16, 0, 0, Math.PI * 2); c.stroke();
    });
  }

  /* ---------- blood ---------- */
  /** An organic blob outline: seeded radius noise, k grows it (0..1). */
  function blobPath(c, cx, cy, r, seed, k, lumps) {
    const rnd = mulberry32(seed);
    const n = 64; const ph = []; for (let i = 0; i < 5; i++) ph.push(rnd() * 6.28);
    const amp = lumps == null ? 0.12 : lumps;
    c.moveTo(cx + r * k, cy);
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * k * (1 + amp * (Math.sin(a * 3 + ph[0]) * 0.5 + Math.sin(a * 5 + ph[1]) * 0.3 + Math.sin(a * 9 + ph[2]) * 0.2));
      c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath();
  }
  /** A pool of blood with a darker heart, satellite droplets and, as it spreads, a thin wet rim. */
  function bloodPool(sh, cx, cy, r, seed, k, o) {
    if (k <= 0) return;
    const oo = o || {};
    const rnd = mulberry32(seed + 9);
    sh.layer(MAT.blood, (c) => { c.beginPath(); blobPath(c, cx, cy, r, seed, k, oo.lumps); c.fill(); });
    sh.layer({ col: BLOOD.deep, hgt: 252, rgh: 14, blurH: 10, blurC: 8 }, (c) => { c.beginPath(); blobPath(c, cx, cy, r * 0.62, seed + 1, k); c.fill(); });
    const drops = oo.drops == null ? 9 : oo.drops;
    sh.layer(Object.assign({}, MAT.blood, { blurH: 1.5 }), (c) => {
      for (let i = 0; i < drops; i++) {
        const a = rnd() * 6.283; const d = r * (1.15 + rnd() * 0.6) * k; const s = r * (0.03 + rnd() * 0.07) * Math.min(1, k * 1.4);
        c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, 0, 7); c.fill();
      }
    });
  }
  /** A drop of blood falling to the page: fall 0..1 then spread into a pool. */
  function bloodDrop(sh, cx, cy, r, seed, fall, spread) {
    if (fall > 0 && fall < 1) {
      // seen from above, a falling drop is a growing dot with a soft shadow below it
      sh.layer({ col: 'rgba(0,0,0,0.6)', blurC: 10 }, (c) => { c.beginPath(); c.arc(cx + 30 * (1 - fall), cy + 20 * (1 - fall), r * 0.12 * fall, 0, 7); c.fill(); });
    }
    if (fall >= 1) bloodPool(sh, cx, cy, r, seed, E.expo(spread), { drops: 14 });
  }
  /** Beads at a point: n drops that swell (back-out on radius), one of them runs down the page. */
  function beads(sh, cx, cy, r, seed, k, run) {
    if (k <= 0) return;
    const rnd = mulberry32(seed);
    sh.layer(MAT.blood, (c) => {
      for (let i = 0; i < 4; i++) {
        const a = rnd() * 6.283; const d = r * (0.5 + rnd() * 0.9);
        const rr = r * (0.35 + rnd() * 0.45) * E.back(clamp01(k * (1 + i * 0.15)));
        c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(0, rr), 0, 7); c.fill();
      }
      if (run > 0) {
        const len = r * 9 * run; const ww = r * 0.45;
        c.beginPath();
        c.moveTo(cx - ww, cy); c.bezierCurveTo(cx - ww, cy + len * 0.5, cx - ww * 0.4 + 6, cy + len * 0.8, cx + 4, cy + len);
        c.arc(cx + 4, cy + len, ww * 0.9, Math.PI, 0, true);
        c.bezierCurveTo(cx + ww * 0.6 + 6, cy + len * 0.8, cx + ww, cy + len * 0.5, cx + ww, cy);
        c.closePath(); c.fill();
      }
    });
  }
  /** A blood seal: a round pool with a sigil pressed into it (debossed: darker, lower, rougher). */
  function seal(sh, cx, cy, r, seed, k, press, sigil) {
    if (k <= 0) return;
    bloodPool(sh, cx, cy, r, seed, E.expo(k), { drops: 12, lumps: 0.06 });
    if (press > 0) {
      sh.layer({ col: 'rgba(40,0,0,' + (0.85 * press).toFixed(3) + ')', hgt: 150, rgh: 70, alpha: press, blurH: 1.5 }, (c) => {
        c.lineWidth = r * 0.07; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.arc(cx, cy, r * 0.78, 0, 7); c.stroke();
        c.lineWidth = r * 0.025; c.beginPath(); c.arc(cx, cy, r * 0.66, 0, 7); c.stroke();
        c.lineWidth = r * 0.08;
        sigil(c, cx, cy, r * 0.5);
      });
    }
  }
  const SIGILS = {
    fork(c, x, y, r) { // one line splits in two and the two rejoin: branch out, merge in
      c.beginPath(); c.moveTo(x, y + r); c.lineTo(x, y + r * 0.45);
      c.bezierCurveTo(x - r * 0.75, y + r * 0.1, x - r * 0.75, y - r * 0.1, x, y - r * 0.45);
      c.moveTo(x, y + r * 0.45); c.bezierCurveTo(x + r * 0.75, y + r * 0.1, x + r * 0.75, y - r * 0.1, x, y - r * 0.45);
      c.lineTo(x, y - r); c.stroke();
    },
    lock(c, x, y, r) {
      c.beginPath(); c.rect(x - r * 0.55, y - r * 0.1, r * 1.1, r * 0.95); c.stroke();
      c.beginPath(); c.arc(x, y - r * 0.1, r * 0.38, Math.PI, 0); c.stroke();
      c.beginPath(); c.arc(x, y + r * 0.3, r * 0.1, 0, 7); c.stroke();
    },
    shut(c, x, y, r) { // a closed eye
      c.beginPath(); c.moveTo(x - r, y); c.quadraticCurveTo(x, y + r * 0.7, x + r, y); c.stroke();
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x + i * r * 0.36, y + r * 0.32 - Math.abs(i) * r * 0.08); c.lineTo(x + i * r * 0.44, y + r * 0.62 - Math.abs(i) * r * 0.1); c.stroke(); }
    },
    cmd(c, x, y, r) { cmdGlyph(c, x, y, r, c.lineWidth); }
  };

  /* ---------- flesh ---------- */
  /** The binding: mottled flesh, wrinkles, pores, veins, patches sewn together with black thread. */
  function flesh(sh, seed, o) {
    const oo = o || {};
    const rnd = mulberry32(seed);
    const { c, hx, rx } = sh;
    c.save(); c.fillStyle = '#251110'; c.fillRect(0, 0, PW, PH); c.restore();
    // mottling
    sh.layer({ col: '#3e1b16', alpha: 0.35, blurC: 18 }, (x) => {
      for (let i = 0; i < 160; i++) { x.beginPath(); x.ellipse(rnd() * PW, rnd() * PH, 20 + rnd() * 70, 14 + rnd() * 50, rnd() * 3, 0, 7); x.fill(); }
    });
    sh.layer({ col: '#0c0504', alpha: 0.3, blurC: 14 }, (x) => {
      for (let i = 0; i < 120; i++) { x.beginPath(); x.ellipse(rnd() * PW, rnd() * PH, 14 + rnd() * 50, 10 + rnd() * 40, rnd() * 3, 0, 7); x.fill(); }
    });
    // fine skin: a grain of tiny creases in the height only
    sh.layer({ col: 'rgba(0,0,0,0.12)', hgt: 100 }, (x) => {
      x.lineWidth = 1;
      for (let i = 0; i < 2600; i++) { const px = rnd() * PW; const py = rnd() * PH; const a = rnd() * 3.14; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 14, py + Math.sin(a) * 14); x.stroke(); }
    });
    hx.save(); hx.setTransform(1, 0, 0, 1, 0, 0); hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, sh.hc.width, sh.hc.height); hx.restore();
    rx.save(); rx.setTransform(1, 0, 0, 1, 0, 0); rx.fillStyle = 'rgb(150,150,150)'; rx.fillRect(0, 0, sh.rc.width, sh.rc.height); rx.restore();
    // pores
    sh.layer({ col: 'rgba(20,6,5,0.55)', hgt: 90 }, (x) => {
      for (let i = 0; i < 5000; i++) { const s = 0.8 + rnd() * 2.2; x.fillRect(rnd() * PW, rnd() * PH, s, s); }
    });
    // wrinkles: sinuous creases that dip
    const crease = (x, y, len, ang, wob) => {
      const pts = []; let a = ang; let px = x; let py = y;
      for (let i = 0; i < 30; i++) { pts.push([px, py]); a += (rnd() - 0.5) * wob; px += Math.cos(a) * len / 30; py += Math.sin(a) * len / 30; }
      return pts;
    };
    for (let i = 0; i < 90; i++) {
      const pts = crease(rnd() * PW, rnd() * PH, 60 + rnd() * 240, rnd() * 6.28, 0.5);
      const lw = 1 + rnd() * 3;
      sh.layer({ col: 'rgba(16,5,4,0.6)', hgt: 70, rgh: 120 }, (x) => { x.lineWidth = lw; x.lineCap = 'round'; x.beginPath(); pts.forEach((p, j) => (j ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke(); });
      sh.layer({ col: 'rgba(90,48,40,0.22)', hgt: 170 }, (x) => { x.lineWidth = lw * 0.8; x.translate(-lw * 1.2, -lw * 1.2); x.beginPath(); pts.forEach((p, j) => (j ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke(); });
    }
    // veins: branching, raised, a cold dark red
    for (let i = 0; i < 7; i++) {
      let pts = crease(rnd() * PW, rnd() * PH, 260 + rnd() * 400, rnd() * 6.28, 0.35);
      sh.layer({ col: 'rgba(40,10,22,0.55)', hgt: 175, blurH: 2 }, (x) => {
        x.lineCap = 'round';
        for (let b = 0; b < 4; b++) {
          x.lineWidth = 6 - b * 1.3; x.beginPath(); pts.forEach((p, j) => (j ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke();
          const at = pts[Math.floor(8 + rnd() * 18)];
          pts = crease(at[0], at[1], 100 + rnd() * 160, rnd() * 6.28, 0.4);
        }
      });
    }
    // patches sewn together: seams with cross stitches
    const seams = oo.seams || [];
    seams.forEach((sm) => {
      sh.layer({ col: 'rgba(10,3,2,0.85)', hgt: 50, rgh: 160 }, (x) => { x.lineWidth = 4; x.beginPath(); sm.forEach((p, j) => (j ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke(); });
      sh.layer({ col: 'rgba(120,64,52,0.35)', hgt: 185, blurH: 3 }, (x) => { x.lineWidth = 10; x.beginPath(); sm.forEach((p, j) => (j ? x.lineTo(p[0] - 7, p[1] - 7) : x.moveTo(p[0] - 7, p[1] - 7))); x.stroke(); });
      const pts = []; for (let j = 1; j < sm.length; j++) for (let q = 0; q < 1; q += 0.12) pts.push([lerp(sm[j - 1][0], sm[j][0], q), lerp(sm[j - 1][1], sm[j][1], q), Math.atan2(sm[j][1] - sm[j - 1][1], sm[j][0] - sm[j - 1][0])]);
      pts.forEach(([px, py, a]) => stitch(sh, px, py, a, 26, 1));
    });
    // corner bosses: hammered iron studs
    (oo.studs || []).forEach(([sx, sy]) => {
      sh.layer({ col: '#26201c', hgt: 250, rgh: 90, blurH: 6 }, (x) => { x.beginPath(); x.arc(sx, sy, 34, 0, 7); x.fill(); });
      sh.layer({ col: '#4a403a', hgt: 255, rgh: 70 }, (x) => { x.beginPath(); x.arc(sx - 6, sy - 6, 14, 0, 7); x.fill(); });
    });
  }
  /** One cross stitch of black thread across a seam at angle a. torn 0..1 pulls it apart. */
  function stitch(sh, x, y, a, len, whole, torn) {
    const tr = torn || 0;
    const nx = -Math.sin(a); const ny = Math.cos(a); const tx = Math.cos(a); const ty = Math.sin(a);
    const L = len;
    // holes
    sh.layer({ col: 'rgba(8,2,1,0.9)', hgt: 40 }, (c) => {
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([p, q]) => { c.beginPath(); c.arc(x + nx * L * p * 0.55 + tx * L * q * 0.35, y + ny * L * p * 0.55 + ty * L * q * 0.35, 3.2, 0, 7); c.fill(); });
    });
    sh.layer({ col: '#0b0605', hgt: 215, rgh: 80, blurH: 1 }, (c) => {
      c.lineWidth = len * 0.2; c.lineCap = 'round';
      [[1, -1], [-1, -1]].forEach(([p]) => {
        const ax = x + nx * L * 0.55 * p - tx * L * 0.35; const ay = y + ny * L * 0.55 * p - ty * L * 0.35;
        const bx = x - nx * L * 0.55 * p + tx * L * 0.35; const by = y - ny * L * 0.55 * p + ty * L * 0.35;
        if (tr <= 0) { c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); return; }
        // torn: two short ends curling back to their holes
        const k = 0.5 - 0.42 * E.out3(tr);
        const mx = lerp(ax, bx, k); const my = lerp(ay, by, k); const ex = lerp(bx, ax, k); const ey = lerp(by, ay, k);
        c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(lerp(ax, mx, 0.5) - nx * 10 * tr, lerp(ay, my, 0.5) - ny * 10 * tr, mx, my); c.stroke();
        c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(lerp(bx, ex, 0.5) + nx * 10 * tr, lerp(by, ey, 0.5) + ny * 10 * tr, ex, ey); c.stroke();
      });
    });
    void whole;
  }

  /* ---------- eyes ---------- */
  function almond(c, cx, cy, w, h) {
    c.moveTo(cx - w / 2, cy);
    c.bezierCurveTo(cx - w * 0.22, cy - h * 1.05, cx + w * 0.22, cy - h * 1.05, cx + w / 2, cy);
    c.bezierCurveTo(cx + w * 0.22, cy + h * 0.85, cx - w * 0.22, cy + h * 0.85, cx - w / 2, cy);
    c.closePath();
  }
  /** A real eye grown in the page. st: { open 0..1, lx, ly (look, -1..1), pupil 0..1, nailed, seed, lid } */
  function eye(sh, cx, cy, w, st) {
    const open = clamp01(st.open);
    const hMax = w * 0.27; const h = Math.max(0.0001, hMax * open);
    // the socket: a dark hollow with flesh lids around it
    // the socket: the page swells into lids around a hollow; every edge is soft, nothing reads as a disc
    sh.layer({ col: 'rgba(5,1,1,0.55)', blurC: w * 0.1 }, (c) => { c.beginPath(); c.ellipse(cx + w * 0.04, cy + hMax * 0.2, w * 0.66, hMax * 1.9, 0, 0, 7); c.fill(); });
    sh.layer({ col: st.lid || '#4d2520', alpha: 0.95, blurC: w * 0.07 }, (c) => { c.beginPath(); c.ellipse(cx, cy, w * 0.56, hMax * 1.45, 0, 0, 7); c.fill(); });
    sh.layer({ col: 'rgba(0,0,0,0)', hgt: 200, blurH: w * 0.06 }, (c) => { c.beginPath(); c.ellipse(cx, cy, w * 0.55, hMax * 1.4, 0, 0, 7); c.fill(); });
    sh.layer({ col: 'rgba(0,0,0,0)', hgt: 150, blurH: w * 0.03 }, (c) => { c.beginPath(); almond(c, cx, cy, w * 0.98, hMax * 1.05); c.fill(); });
    // the candle is low on the upper left: the swollen lids catch it there and fall into shadow below right
    sh.layer({ col: 'rgba(255,170,130,0.16)', blurC: w * 0.09 }, (c) => { c.beginPath(); c.ellipse(cx - w * 0.12, cy - hMax * 0.75, w * 0.36, hMax * 0.7, -0.15, 0, 7); c.fill(); });
    sh.layer({ col: 'rgba(0,0,0,0.5)', blurC: w * 0.08 }, (c) => { c.beginPath(); c.ellipse(cx + w * 0.16, cy + hMax * 1.15, w * 0.42, hMax * 0.55, -0.1, 0, 7); c.fill(); });
    if (open <= 0.02) {
      // shut: the upper lid rolls over the lower one, a deep crease between them
      sh.layer({ col: 'rgba(255,170,130,0.12)', blurC: w * 0.02 }, (c) => { c.beginPath(); c.ellipse(cx - w * 0.04, cy - hMax * 0.32, w * 0.4, hMax * 0.32, 0, Math.PI, 0); c.fill(); });
      sh.layer({ col: 'rgba(0,0,0,0.7)', hgt: 60, blurC: 3 }, (c) => { c.lineWidth = w * 0.03; c.beginPath(); c.moveTo(cx - w * 0.47, cy); c.quadraticCurveTo(cx, cy + hMax * 0.24, cx + w * 0.47, cy); c.stroke(); });
    }
    sh.layer({ col: 'rgba(14,4,3,0.6)', hgt: 120 }, (c) => { // the crease above the lid
      c.lineWidth = w * 0.012; c.beginPath(); c.moveTo(cx - w * 0.5, cy - hMax * 0.2); c.quadraticCurveTo(cx, cy - hMax * 1.55, cx + w * 0.5, cy - hMax * 0.2); c.stroke();
      c.beginPath(); c.moveTo(cx - w * 0.38, cy + hMax * 0.6); c.quadraticCurveTo(cx, cy + hMax * 1.25, cx + w * 0.38, cy + hMax * 0.6); c.stroke();
    });
    if (open > 0.02) {
      const ix = cx + (st.lx || 0) * w * 0.17; const iy = cy + (st.ly || 0) * h * 0.18;
      const ir = w * 0.19; const pr = ir * (0.3 + 0.28 * clamp01(st.pupil == null ? 0.4 : st.pupil));
      const clip = (c) => { c.beginPath(); almond(c, cx, cy, w * 0.92, h); c.clip(); };
      sh.layer({ col: '#c9b48e', hgt: 205, rgh: 10 }, (c) => { clip(c); c.fillRect(cx - w, cy - hMax * 2, w * 2, hMax * 4); });
      sh.layer({ col: 'rgba(60,10,10,0.55)', hgt: 205, rgh: 10 }, (c) => { // corner shading and veins
        clip(c);
        const g = c.createRadialGradient(cx, cy, w * 0.1, cx, cy, w * 0.5); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(50,8,8,0.85)');
        c.fillStyle = g; c.fillRect(cx - w, cy - hMax * 2, w * 2, hMax * 4);
        c.strokeStyle = 'rgba(150,20,20,0.7)'; c.lineWidth = Math.max(1, w * 0.006);
        const rnd = mulberry32((st.seed || 1) * 7);
        for (let i = 0; i < 9; i++) {
          const side = i % 2 ? 1 : -1; let px = cx + side * w * 0.45; let py = cy + (rnd() - 0.5) * h; let a = side > 0 ? Math.PI : 0;
          c.beginPath(); c.moveTo(px, py);
          for (let j = 0; j < 8; j++) { a += (rnd() - 0.5) * 0.9; px += Math.cos(a) * w * 0.03; py += Math.sin(a) * w * 0.03; c.lineTo(px, py); }
          c.stroke();
        }
      });
      sh.layer({ col: MAGENTA, hgt: 225, rgh: 8 }, (c) => { clip(c); c.beginPath(); c.arc(ix, iy, ir, 0, 7); c.fill(); });
      sh.layer({ col: '#b8306f', hgt: 225, rgh: 8 }, (c) => { // fibres and the dark limbal ring
        clip(c);
        c.lineWidth = Math.max(1, ir * 0.03);
        c.beginPath();
        for (let i = 0; i < 64; i++) { const a = (i / 64) * 6.283; const r0 = pr * 1.05; const r1 = ir * (0.82 + 0.12 * Math.sin(i * 2.3)); c.moveTo(ix + Math.cos(a) * r0, iy + Math.sin(a) * r0); c.lineTo(ix + Math.cos(a + 0.05) * r1, iy + Math.sin(a + 0.05) * r1); }
        c.stroke();
        c.strokeStyle = '#5a0f36'; c.lineWidth = ir * 0.14; c.beginPath(); c.arc(ix, iy, ir * 0.94, 0, 7); c.stroke();
      });
      sh.layer({ col: '#ffa3d2', hgt: 225, rgh: 8, alpha: 0.45 }, (c) => { clip(c); c.lineWidth = ir * 0.08; c.beginPath(); c.arc(ix, iy, pr * 1.35, 0, 7); c.stroke(); });
      sh.layer({ col: '#040102', hgt: 225, rgh: 6 }, (c) => { clip(c); c.beginPath(); c.arc(ix, iy, pr, 0, 7); c.fill(); });
      // the upper lid's shadow over the eyeball
      sh.layer({ col: 'rgba(10,2,2,0.55)', blurC: w * 0.03 }, (c) => { clip(c); c.beginPath(); c.ellipse(cx, cy - h * 0.95, w * 0.5, h * 0.45, 0, 0, 7); c.fill(); });
    }
    // lid margins and lashes
    sh.layer({ col: '#120605', hgt: 160, rgh: 120 }, (c) => {
      c.lineWidth = w * 0.022; c.lineCap = 'round';
      c.beginPath();
      if (open > 0.02) { almond(c, cx, cy, w * 0.92, h); } else { c.moveTo(cx - w * 0.46, cy); c.quadraticCurveTo(cx, cy + hMax * 0.22, cx + w * 0.46, cy); }
      c.stroke();
      c.lineWidth = w * (open > 0.02 ? 0.008 : 0.011);
      c.beginPath();
      for (let i = 1; i < 18; i++) {
        const u = i / 18; const x = cx - w * 0.46 + u * w * 0.92;
        const yy = open > 0.02 ? cy - h * 4 * u * (1 - u) * 0.8 : cy + hMax * 0.22 * 4 * u * (1 - u) * 0.5;
        const ang = -Math.PI / 2 + (u - 0.5) * 1.6; const len = w * (open > 0.02 ? 0.06 + 0.03 * Math.sin(i * 1.7) : 0.1 + 0.05 * Math.sin(i * 1.7));
        const dir = open > 0.02 ? 1 : -1;
        c.moveTo(x, yy); c.quadraticCurveTo(x + Math.cos(ang) * len * 0.5, yy + dir * Math.sin(ang) * len * 0.3, x + Math.cos(ang) * len * 0.7, yy + dir * Math.sin(ang) * len);
      }
      c.stroke();
    });
  }

  /* ---------- the Wavi mark ---------- */
  let ORBIT = null;
  function orbitPath() {
    if (ORBIT) return ORBIT;
    const O = window.WAVI_ORBIT;
    ORBIT = { path: new Path2D(O.d), vb: O.viewBox };
    return ORBIT;
  }
  /** Places the mark so its height is h, centred on cx, cy, and runs draw(c) with that transform. */
  function withOrbit(c, cx, cy, h, draw) {
    const { vb } = orbitPath();
    const s = h / vb[3];
    c.save(); c.translate(cx, cy); c.scale(s, s); c.translate(-(vb[0] + vb[2] / 2), -(vb[1] + vb[3] / 2));
    draw(c, orbitPath().path, s);
    c.restore();
  }

  window.Plates = {
    PW, PH, FRAK, BOD, ITAL, BLOOD, MAGENTA,
    inkText, cmdText, cmdGlyph, rule, caps, ital,
    polyLen, bez, strokePart, hatch, tube, frameRect, frameOval,
    blobPath, bloodPool, bloodDrop, beads, seal, SIGILS,
    flesh, stitch, almond, eye, orbitPath, withOrbit
  };
})();
