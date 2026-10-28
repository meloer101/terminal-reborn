/* Film E3's television: what the site's tube (assets/lib/tube.js, from film D1) shows behind the burning page and at
   the end. Both painters draw into the tube's source canvas and are pure functions of time. */
(function () {
  const T = window.WaviTube;

  /** The site's line-screen orbit, placed anywhere: drawn once centred, then moved to cx, cy at height h. */
  function orbitLayer(W, H) {
    const SIZE = 0.82;
    const paint = T.orbit(W, H, { size: SIZE, rows: 70 });
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const ox = off.getContext('2d');
    return function (ctx, t, cx, cy, h) {
      ox.setTransform(1, 0, 0, 1, 0, 0); ox.fillStyle = '#000'; ox.fillRect(0, 0, W, H);
      paint(ox, { t, spin: 0, reveal: 1, amp: 0.55, ink: '#f4ede4' });
      const k = h / (H * SIZE);
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    };
  }

  /** The end card: the sky WAVI rises out of the middle, then the button prints. tl = seconds from the card's start. */
  function waviCard(W, H, img, opts) {
    const o = opts || {};
    const LETTERS = { cx: 1425, cy: 756, w: 2361 }; // the letters' box inside the Figma export (2880 x 1520)
    const base = (W * (o.width || 0.84)) / LETTERS.w;
    const e3 = (k) => 1 - Math.pow(1 - k, 3);
    return function (ctx, tl) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const rise = e3(T.ramp(tl, 0.35, 0.95));
      const s = base * (1 - 0.18 * rise);
      const cy = H * (0.5 - 0.09 * rise);
      ctx.drawImage(img, W / 2 - LETTERS.cx * s, cy - LETTERS.cy * s, img.width * s, img.height * s);
      if (tl >= 0.75) {
        const bw = 600; const bh = 112; const by = H * 0.6;
        ctx.fillStyle = '#ededed';
        ctx.beginPath(); ctx.roundRect(W / 2 - bw / 2, by, bw, bh, 18); ctx.fill();
        T.text(ctx, 'Download for macOS', W / 2, by + bh / 2 + 2, { font: '700 54px ' + T.GROT, fill: '#050505' });
      }
    };
  }

  window.WaviCard = { orbitLayer, waviCard };
})();
