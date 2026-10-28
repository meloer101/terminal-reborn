/* Wavi's dark UI rebuilt at 2x for canvas (a-waiting's rebuild of src/renderer: the sidebar with two projects and
   StatusGlyph rows, the main terminal, keycaps). Colours from src/renderer/styles/tokens.css. */
(function () {
  const R = window.Rec;
  const ACCENT = '#ff5fb0';
  const RUN = '#5ea1ff';
  const INK = '#ededed';
  const SUB = '#a1a1a1';
  const DIM = '#6b6b6b';

  // Rows: the same eight sessions as the wall; `pane` is the wall pane each one folds from.
  const HEADS = [{ name: 'acme-web', count: '5', y: 40 }, { name: 'terminal-reborn', count: '3', y: 656 }];
  const ROWS = [
    { pane: 5, y: 112, title: 'Session cookie migration', sub: 'Confirm: pnpm prisma migrate dev', subRun: 'Running pnpm prisma migrate dev', meta: 'waiting 23m', metaRun: 'just now', diff: '+42 −18' },
    { pane: 0, y: 216, title: 'Checkout performance', sub: 'Running pnpm test checkout', meta: '12m', diff: '+128 −35' },
    { pane: 3, y: 320, title: 'Fix mobile nav jitter', sub: 'Snapshotting three breakpoints', meta: '2m', diff: '+23 −9' },
    { pane: 4, y: 424, title: 'Payment webhook retries', sub: 'Running pnpm vitest webhook', meta: '9m', diff: '+19 −2' },
    { pane: 7, y: 528, title: 'Move to Vite 7', sub: 'Checking the dev server', meta: '3m', diff: '+40 −31' },
    { pane: 1, y: 728, title: 'Sidebar status rollup', sub: 'Reading src/state/agents.ts', meta: '6m', diff: '+61 −4' },
    { pane: 6, y: 832, title: 'Git graph layout', sub: 'Laying out merge lanes', meta: '18m', diff: '+210 −12' },
    { pane: 2, y: 936, title: 'Docs search', sub: 'Running pnpm vitest rank', meta: '5m', diff: '+88 −14' }
  ];
  const ROW = { x: 16, w: 728, h: 104 };
  const glyphAt = (r) => ({ x: ROW.x + 56 + 14, y: r.y + 16 + 4 + 14 });

  /** StatusGlyph at 2x: 'needs' (magenta dot with halo), 'running' (blue arc spinning on a ring), 'idle'. */
  function glyph(ctx, x, y, status, t, s) {
    const k = s || 1;
    ctx.save();
    if (status === 'needs') {
      ctx.fillStyle = 'rgba(255,95,176,0.16)';
      ctx.beginPath(); ctx.arc(x, y, 14 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ACCENT;
      ctx.beginPath(); ctx.arc(x, y, 8 * k, 0, Math.PI * 2); ctx.fill();
    } else if (status === 'running') {
      const a = -Math.PI / 2 + t * Math.PI * 2 * 0.9;
      ctx.lineWidth = 3.6 * k;
      ctx.strokeStyle = '#ffffff2e';
      ctx.beginPath(); ctx.arc(x, y, 10.2 * k, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = RUN;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, 10.2 * k, a, a + 2.3); ctx.stroke();
    } else {
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = DIM;
      ctx.beginPath(); ctx.arc(x, y, 6.5 * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /** The sidebar. st: { t, waiting (1 = the cookie row needs you), sel (row index selected), alpha, rowAlpha[i] } */
  function sidebar(ctx, st) {
    const a = st.alpha == null ? 1 : st.alpha;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, 760, 1080);
    ctx.fillStyle = '#ffffff12';
    ctx.fillRect(760, 0, 2, 1080);
    HEADS.forEach((h) => {
      // Chevron, project name, count.
      ctx.strokeStyle = DIM; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(38, h.y + 31); ctx.lineTo(46, h.y + 39); ctx.lineTo(54, h.y + 31); ctx.stroke();
      R.text(ctx, h.name, 76, h.y + 46, { font: '600 28px ' + R.SANS, fill: INK });
      R.text(ctx, h.count, 720, h.y + 46, { font: '400 26px ' + R.MONO, fill: DIM, align: 'right' });
    });
    ROWS.forEach((r, i) => {
      const ra = st.rowAlpha ? st.rowAlpha[i] : 1;
      if (ra <= 0) return;
      ctx.save();
      ctx.globalAlpha = a * ra;
      if (st.sel === i) {
        ctx.fillStyle = '#ffffff12';
        ctx.beginPath(); ctx.roundRect(ROW.x, r.y, ROW.w, ROW.h, 10); ctx.fill();
      }
      const g = glyphAt(r);
      const needs = i === 0 && st.waiting > 0.5;
      glyph(ctx, g.x, g.y, needs ? 'needs' : 'running', st.t + i * 0.13);
      R.text(ctx, r.title, 116, r.y + 16 + 28, { font: '400 26px ' + R.SANS, fill: INK });
      const sub = needs ? r.sub : r.subRun || r.sub;
      if (!(i === 0 && st.hideSub)) R.text(ctx, sub, 116, r.y + 16 + 40 + 25, { font: '400 24px ' + R.SANS, fill: needs ? ACCENT : SUB });
      R.text(ctx, needs ? r.meta : r.metaRun || r.meta, 720, r.y + 16 + 28, { font: (needs ? '500' : '400') + ' 24px ' + R.MONO, fill: needs ? INK : DIM, align: 'right' });
      const [add, del] = r.diff.split(' ');
      ctx.font = '400 24px ' + R.MONO;
      const dw = ctx.measureText(del).width;
      R.text(ctx, del, 720, r.y + 16 + 40 + 25, { font: '400 24px ' + R.MONO, fill: '#808080', align: 'right' });
      R.text(ctx, add, 720 - dw - 12, r.y + 16 + 40 + 25, { font: '400 24px ' + R.MONO, fill: '#3dd68c', align: 'right' });
      ctx.restore();
    });
    ctx.restore();
  }
  const subX = 116;
  const subY = (r) => r.y + 16 + 40 + 25;

  /** The main area: header plus terminal lines at 26/40. */
  const MAIN = { x: 762, w: 1158, tx: 810, ty: 168, fs: 26, lh: 40 };
  const MCW = MAIN.fs * 0.6;
  const MFONT = '400 26px ' + R.MONO;
  function main(ctx, st) {
    const a = st.alpha == null ? 1 : st.alpha;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.roundRect(MAIN.x, 0, MAIN.w + 40, 1080, [32, 0, 0, 32]); ctx.fill();
    ctx.fillStyle = '#ffffff0a';
    ctx.fillRect(MAIN.x, 88, MAIN.w, 2);
    glyph(ctx, MAIN.x + 60, 44, st.status, st.t);
    R.text(ctx, st.title, MAIN.x + 92, 54, { font: '600 30px ' + R.SANS, fill: INK });
    ctx.font = '600 30px ' + R.SANS;
    const tw = ctx.measureText(st.title).width;
    R.text(ctx, st.path, MAIN.x + 92 + tw + 20, 54, { font: '400 26px ' + R.MONO, fill: DIM });
    ctx.restore();
  }
  /** One terminal line in the main area; skip(col) leaves a glyph out (it has turned to blood). */
  function mline(ctx, src, row, a, skip) {
    const sp = R.spans(src);
    let col = 0;
    ctx.save();
    ctx.globalAlpha *= a == null ? 1 : a;
    ctx.font = MFONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const [c, t] of sp) {
      ctx.fillStyle = R.C[c] || R.C.n;
      for (let i = 0; i < t.length; i++, col++) {
        if (t[i] === ' ' || (skip && skip(col))) continue;
        ctx.fillText(t[i], MAIN.tx + col * MCW, MAIN.ty + row * MAIN.lh);
      }
    }
    ctx.restore();
  }
  const mx = (col) => MAIN.tx + col * MCW;
  const my = (row) => MAIN.ty + row * MAIN.lh;

  /** A keycap HUD (a-waiting's): keys = ['⌘', 'J'], verb; press (0..1) fills the keys. Drawn on the OSD layer. */
  function hud(ctx, keys, verb, cx, y, a, press) {
    if (!ctx || a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '500 36px ' + R.KEYS;
    const vw = ctx.measureText(verb).width;
    const kw = keys.map((k) => Math.max(88, 44 + k.length * 26));
    const w = 28 + kw.reduce((s, x) => s + x, 0) + (keys.length - 1) * 10 + 24 + vw + 28;
    const x0 = cx - w / 2;
    ctx.fillStyle = '#050505';
    ctx.beginPath(); ctx.roundRect(x0, y, w, 124, 20); ctx.fill();
    ctx.strokeStyle = '#ffffff1c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x0 + 1, y + 1, w - 2, 122, 20); ctx.stroke();
    let x = x0 + 28;
    keys.forEach((k, i) => {
      const dy = press > 0 ? 4 * Math.sin(Math.PI * Math.min(press, 1)) : 0;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.roundRect(x, y + 18 + 6, kw[i], 88, 14); ctx.fill();
      ctx.fillStyle = press > 0 ? '#ededed' : '#161616';
      ctx.beginPath(); ctx.roundRect(x, y + 18 + dy, kw[i], 88, 14); ctx.fill();
      ctx.strokeStyle = '#ffffff2e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x + 1, y + 19 + dy, kw[i] - 2, 86, 14); ctx.stroke();
      R.text(ctx, k, x + kw[i] / 2, y + 18 + dy + 60, { font: '500 44px ' + R.KEYS, fill: press > 0 ? '#0a0a0a' : '#ededed', align: 'center' });
      x += kw[i] + 10;
    });
    R.text(ctx, verb, x + 14, y + 75, { font: '500 36px ' + R.KEYS, fill: '#ededed' });
    ctx.restore();
  }

  window.WaviUI = { ROWS, HEADS, ROW, glyphAt, glyph, sidebar, subX, subY, MAIN, MCW, MFONT, main, mline, mx, my, hud, ACCENT, RUN };
})();
