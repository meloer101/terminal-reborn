/* The blood field: drips, trails, pools and melting glyphs painted as white into the `blood` canvas, where the
   value is thickness. rec.js thresholds it at 0.5 and shades it as liquid, so overlapping blobs merge like
   surface tension (metaballs). Every function is closed-form in time: a drip's position is a function of its
   age, so the same frame always comes back and the blood can run backwards by running its clock backwards. */
(function () {
  const R = window.Rec;
  // A soft blob: (1 - (d/Rm)^2)^2, which crosses 0.5 at 0.541 Rm, so a sprite of radius Rm shows a drop of 0.541 Rm.
  const SPR = (() => {
    const c = document.createElement('canvas');
    const N = 128;
    c.width = N; c.height = N;
    const x = c.getContext('2d');
    const img = x.createImageData(N, N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const dx = (i + 0.5 - N / 2) / (N / 2);
        const dy = (j + 0.5 - N / 2) / (N / 2);
        const d2 = dx * dx + dy * dy;
        const v = d2 >= 1 ? 0 : Math.pow(1 - d2, 2);
        const k = (j * N + i) * 4;
        img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255; img.data[k + 3] = Math.round(v * 255);
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  })();
  const K = 1 / 0.541;

  /** A drop of visible radius r at (x, y); sy > 1 stretches it downward (a hanging, swelling bead). */
  function blob(ctx, x, y, r, sy, a) {
    if (r <= 0.05) return;
    const rm = r * K;
    const s = sy || 1;
    ctx.globalAlpha = a == null ? 1 : a;
    ctx.drawImage(SPR, x - rm, y - rm * (2 - s) * 0.5 - rm * (s - 1) * 0.2, rm * 2, rm * 2 * s);
  }

  /**
   * A drip: d = { x, y0, t0, r, v, f (stick-slip Hz), amp (0..0.95), seed }.
   * It swells under its source for `swell` s, then runs down in surges and near-stops, leaving a thinning trail,
   * and is swallowed by the surface floor(t) (a function: where the pool or the pane bottom is at time t).
   */
  function drip(ctx, d, t, floor) {
    const age = t - d.t0;
    if (age <= 0) return null;
    const swell = d.swell || 0.55;
    const k = Math.min(age / swell, 1);
    const r = d.r * (0.3 + 0.7 * R.out3(k));
    const fl = floor(t);
    let y; let s = 0;
    if (age < swell) {
      y = d.y0 + r * 0.8;
    } else {
      const b = age - swell;
      const w = 2 * Math.PI * d.f;
      s = d.v * (b - d.amp * Math.sin(w * b) / w) * (1 + 0.22 * b);
      y = d.y0 + r * 0.8 + s;
    }
    const wob = (yy) => d.x + 1.1 * Math.sin(yy * 0.08 + d.seed * 6.3) + 0.6 * Math.sin(yy * 0.23 + d.seed);
    // Trail: thin rivulet from the source to the head, thinner near the source, drying a little with age.
    const end = Math.min(y, fl);
    if (s > 0) {
      const tr = d.r * 0.36 * (1 - 0.35 * R.clamp01((age - swell) / 5));
      for (let yy = d.y0 + 1; yy < end - 1; yy += 2.6) {
        const along = (yy - d.y0) / Math.max(1, end - d.y0);
        blob(ctx, wob(yy), yy, tr * (0.55 + 0.45 * along), 1, 1);
      }
    }
    if (y < fl) {
      // The head: a bead that sags while it pauses (speed low) and stretches while it runs.
      const b = Math.max(0, age - swell);
      const w = 2 * Math.PI * d.f;
      const speed = age < swell ? 0 : d.v * (1 - d.amp * Math.cos(w * b));
      const sy = 1 + Math.min(0.9, speed / (d.v * 2.2)) * 0.6 + (age < swell ? 0.25 * k : 0);
      blob(ctx, wob(y), y, r, sy, 1);
      blob(ctx, wob(y), y - r * 0.9, r * 0.62, 1, 1);
      return { x: wob(y), y, landed: false };
    }
    // Landed: the head merges into the surface as a fading bulge.
    const tl = landTime(d, fl);
    const m = R.clamp01((t - tl) / 0.4);
    if (m < 1) blob(ctx, wob(fl), fl - r * 0.3 * (1 - m), r * (1 - m * 0.7), 1, 1 - m);
    return { x: wob(fl), y: fl, landed: true, at: tl };
  }
  /** When a drip reaches a level y (static approximation, good to a frame for slowly moving floors). */
  function landTime(d, yl) {
    const swell = d.swell || 0.55;
    const need = yl - (d.y0 + d.r * 0.8);
    if (need <= 0) return d.t0 + swell;
    let lo = 0; let hi = 60;
    const w = 2 * Math.PI * d.f;
    const S = (b) => d.v * (b - d.amp * Math.sin(w * b) / w) * (1 + 0.22 * b);
    for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (S(m) < need) lo = m; else hi = m; }
    return d.t0 + swell + hi;
  }

  /**
   * A pool inside a vessel [x0, x1] whose floor is at yb, filled to `level` px. The surface has two slow waves,
   * ripples from impacts [{x, at}] and a meniscus that climbs each wall.
   */
  function pool(ctx, x0, x1, yb, level, t, impacts, top) {
    if (level <= 0.3) return;
    const ys = yb - level;
    const st = Math.max(2, (x1 - x0) / 140);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x0, yb);
    const lim = top == null ? -1e9 : top;
    for (let x = x0; x <= x1 + 0.01; x += st) {
      let y = ys + 1.1 * Math.sin(x * 0.07 + t * 2.1) + 0.7 * Math.sin(x * 0.131 - t * 3.3);
      if (impacts) {
        for (const im of impacts) {
          const a = t - im.at;
          if (a < 0 || a > 2.5) continue;
          const dx = Math.abs(x - im.x);
          y -= 3.2 * Math.exp(-a * 2.2) * Math.cos(dx * 0.32 - a * 9) * Math.exp(-dx / 26);
        }
      }
      const men = Math.min(level, 7);
      y -= men * Math.exp(-(x - x0) / 5) + men * Math.exp(-(x1 - x) / 5);
      ctx.lineTo(x, Math.max(lim, y));
    }
    ctx.lineTo(x1, yb);
    ctx.closePath();
    ctx.fill();
  }

  /** A glyph turned to blood: drawn into the field, sagging downward by `melt` (0..1) from its top. */
  function glyph(ctx, ch, x, y, font, melt, size) {
    const z = size || 14.5;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'alphabetic';
    const m = melt || 0;
    const top = y - z * 0.76;
    ctx.translate(x, top);
    ctx.scale(1, 1 + 0.55 * m);
    ctx.fillText(ch, 0, y - top);
    ctx.strokeText(ch, 0, y - top);
    ctx.restore();
    if (m > 0) blob(ctx, x + z * 0.3, y + z * (0.14 + 0.62 * m), z * (0.11 + 0.11 * m), 1.3, 1);
  }

  window.Blood = { blob, drip, landTime, pool, glyph };
})();
