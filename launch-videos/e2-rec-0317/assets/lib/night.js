/* Act 1, "the night": eight terminals tiled 4 x 2 at 03:17, one frozen on Claude's permission prompt.
   paint(rec, u) draws the whole act for authored time u (one bar = 3.0511 s; the film plays it at 1.5x): the camera,
   the streaming logs turning into R'lyehian chant, the cursor that bleeds, the letters that melt, the pools that rise
   pane after pane. It is a pure function of u, so the rewind scene plays it backwards by passing a decreasing u. */
(function () {
  const R = window.Rec;
  const B = window.Blood;
  const BAR = 3.05111;
  const BEAT = BAR / 4;
  const bar = (n) => n * BAR;
  const ZOOM = 0.86;

  const FS = 14.5;
  const CW = FS * 0.6;
  const LH = 19;
  const FONT = '400 ' + FS + 'px ' + R.MONO;
  const BFONT = '800 ' + FS + 'px ' + R.MONO;
  const PW = 480; const PH = 540;
  const ROWS = 21;
  const RULE = '─'.repeat(51);

  // Copy: a-waiting's rebuild of real Claude Code / Codex output for the same eight sessions.
  const CL = (tool, arg, res, resCol) => ['{g}⏺ {w}' + tool + '{n}(' + arg + ')', '{d}  ⎿  ' + (resCol ? '{' + resCol + '}' : '') + res];
  const CX = (verb, arg, res, resCol) => ['{d}• {w}' + verb + ' {n}' + arg].concat(res ? ['{d}  └ ' + (resCol ? '{' + resCol + '}' : '') + res] : []);
  const PANES = [
    { id: 'checkout', title: 'checkout-perf — claude', kind: 'claude', spin: 'Measuring first paint…', spin0: 72, rate: 1.1, n0: 30,
      lines: [].concat(CL('Read', 'src/checkout/page.tsx', 'Read 214 lines'), CL('Update', 'lib/price.ts', 'Updated lib/price.ts with 6 additions'), [''],
        CL('Bash', 'pnpm test checkout', '38 passed (2.1s)', 'g'), CL('Read', 'components/CartSummary.tsx', 'Read 96 lines'),
        CL('Update', 'components/CartSummary.tsx', 'Memoized cart totals per render'), [''], CL('Bash', 'pnpm build', 'Compiled in 8.4s'),
        CL('Read', 'app/checkout/layout.tsx', 'Read 41 lines'), CL('Update', 'app/checkout/layout.tsx', 'Lazy-loaded CouponPanel'), ['']) },
    { id: 'agg', title: 'sidebar-agg — claude', kind: 'claude', spin: 'Rolling up statuses…', spin0: 361, rate: 0.9, n0: 26,
      lines: [].concat(CL('Search', '"needsAttention"', 'Found 7 files'), CL('Read', 'src/state/agents.ts', 'Read 312 lines'), ['{o}✻ {o}Thinking…'],
        CL('Update', 'src/state/agents.ts', 'Added a rollup selector'), CL('Bash', 'pnpm vitest agents', '14 passed (0.9s)', 'g'), [''],
        CL('Read', 'src/renderer/sidebar/model.ts', 'Read 188 lines'), CL('Update', 'src/renderer/sidebar/model.ts', 'Rows read the rollup'), ['']) },
    { id: 'search', title: 'docs-search — codex', kind: 'codex', spin0: 64, rate: 0.8, n0: 24,
      lines: [].concat(CX('Explored', '', 'Read index.ts, rank.ts'), CX('Edited', 'docs/search/index.ts (+31 -6)'), CX('Ran', 'pnpm docs:build', 'built 312 pages in 6.1s', 'g'),
        CX('Ran', 'pnpm vitest search', '9 passed', 'g'), [''], ['{n}Index now builds incrementally; next I will'], ['{n}rank exact title matches first.'], [''],
        CX('Edited', 'docs/search/rank.ts (+12 -3)'), CX('Ran', 'pnpm vitest rank', '4 passed', 'g'), ['']) },
    { id: 'mobile', title: 'mobile-nav — claude', kind: 'claude', spin: 'Snapshotting three breakpoints…', spin0: 23, rate: 1.3, n0: 28,
      lines: [].concat(CL('Read', 'components/Nav.tsx', 'Read 133 lines'), CL('Bash', 'pnpm playwright test nav', '3 passed', 'g'), [''],
        CL('Update', 'components/Nav.tsx', 'Removed the scroll listener'), CL('Update', 'styles/nav.css', 'Pinned the bar with position: sticky'),
        ['{o}✻ {o}Thinking…'], CL('Bash', 'pnpm playwright test nav', '3 passed', 'g'), ['']) },
    { id: 'webhook', title: 'webhook-retries — codex', kind: 'codex', spin0: 548, rate: 0.7, n0: 22,
      lines: [].concat(CX('Ran', 'pnpm vitest webhook', '12 passed', 'g'), CX('Edited', 'src/webhooks/retry.ts (+19 -2)'), CX('Explored', '', 'Read queue.ts, backoff.ts'),
        CX('Ran', 'pnpm tsc --noEmit', 'no errors', 'g'), [''], ['{n}Retries now back off 1s, 4s, 16s.'], [''], CX('Edited', 'src/webhooks/queue.ts (+8 -1)'), ['']) },
    { id: 'cookie', title: 'session-cookie — claude', kind: 'wait' },
    { id: 'lanes', title: 'git-graph — claude', kind: 'claude', spin: 'Laying out merge lanes…', spin0: 1084, rate: 1.0, n0: 27,
      lines: [].concat(CL('Read', 'src/renderer/panels/graph/lanes.ts', 'Read 241 lines'), CL('Update', 'src/renderer/panels/graph/lanes.ts', 'Lanes reuse freed columns'),
        CL('Bash', 'pnpm vitest lanes', '22 passed', 'g'), [''], CL('Read', 'src/renderer/panels/graph/Graph.tsx', 'Read 96 lines'), ['{o}✻ {o}Thinking…'],
        CL('Update', 'src/renderer/panels/graph/Graph.tsx', 'Merges draw as curves'), ['']) },
    { id: 'vite', title: 'vite-7 — claude', kind: 'claude', spin: 'Checking the dev server…', spin0: 205, rate: 1.2, n0: 25,
      lines: [].concat(CL('Bash', 'pnpm up vite@7', 'Updated 4 packages'), CL('Read', 'vite.config.ts', 'Read 38 lines'),
        CL('Update', 'vite.config.ts', 'Moved to the new environment API'), CL('Bash', 'pnpm build', 'built in 3.9s', 'g'), [''],
        CL('Bash', 'pnpm vitest', '211 passed (6.2s)', 'g'), ['']) }
  ];
  PANES.forEach((p, i) => { p.i = i; p.x = (i % 4) * PW; p.y = Math.floor(i / 4) * PH; });
  const WAIT = PANES[5];
  WAIT.lines = [
    '{d}> {w}Move the session token into an httpOnly', '{w}  cookie', '',
    '{g}⏺ {w}Read{n}(src/middleware.ts)', '{d}  ⎿  Read 88 lines',
    '{g}⏺ {w}Update{n}(prisma/schema.prisma)', '{d}  ⎿  Added model Session',
    '{g}⏺ {w}Update{n}(src/middleware.ts)', '{d}  ⎿  Moved the token to an httpOnly cookie',
    '{g}⏺ {w}Update{n}(src/auth/session.ts)', '{d}  ⎿  Reads the cookie instead of the header',
    '{g}⏺ {w}The Session table needs a migration first.', '',
    '{k}' + RULE, '{v} Bash command', '',
    '{w}   pnpm prisma migrate dev', '{d}   Apply the Session migration to the dev database', '',
    '{w} Do you want to proceed?', '{v} ❯ 1. Yes', '{n}   2. Yes, and don’t ask again for pnpm prisma', '{n}      migrate commands in ~/code/acme-web',
    '{n}   3. No, and tell Claude what to do differently', '{d}      (esc)'
  ];
  const PROMPT = 19;
  const CURSOR_COL = 24;
  const X0 = (p) => p.x + 12;
  const Y0 = (p) => p.y + 28 + 8 + 14;
  const base = (p, row) => Y0(p) + row * LH;
  const colX = (p, c) => X0(p) + c * CW;

  /* ---- Chant ---- */
  const CHANT = ["ph'nglui", "mglw'nafh", 'Cthulhu', "R'lyeh", "wgah'nagl", 'fhtagn'];
  const LINE = "Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn";
  const SCR = "phnglui mglwafh cthulhu rlyeh wgahnagl fhtagn'";
  const ORDER = [2, 1, 4, 6, 0, 3, 7];
  const chantStart = (p) => bar(3.6) + ORDER.indexOf(p.i) * bar(0.2);
  const CH_D = bar(2.7);
  const chantAmt = (p, u) => (p.kind === 'wait' ? 0 : R.ramp(u, chantStart(p), chantStart(p) + CH_D));
  const prefixLen = (s) => { const m = s.match(/^(\s*(⏺|⎿|•|└|✻|>|❯)?\s*)/); return m ? m[1].length : 0; };

  /** One line at chant stage st (0 none, 1 one word, 2 every word, 3 the full chant in caps). */
  function chantLine(src, st, seed) {
    if (st === 0 || !R.plain(src).trim()) return R.spans(src);
    const sp = R.spans(src);
    if (st === 3) {
      const pl = prefixLen(R.plain(src));
      const out = []; let n = 0;
      for (const [c, t] of sp) { if (n >= pl) break; out.push([c, t.slice(0, pl - n)]); n += t.length; }
      out.push(['w', LINE.toUpperCase()]);
      return out;
    }
    let k = Math.floor(seed * 6);
    let done = false;
    return sp.map(([c, t], si) => {
      if (si === 0 && /^(\s*(⏺|⎿|•|└|✻|>)\s*)$/.test(t)) return [c, t];
      const nt = t.replace(/[A-Za-z][A-Za-z0-9]{2,}/g, (w) => {
        if (st === 1 && done) return w;
        if (st === 1 && w.length < 5) return w;
        done = true;
        const cw = CHANT[k++ % 6];
        return w[0] === w[0].toUpperCase() ? cw[0].toUpperCase() + cw.slice(1) : cw;
      });
      return [c, nt];
    });
  }
  function scramble(sp, u, seed) {
    const f = Math.floor(u * 30);
    return sp.map(([c, t], si) => [c, si === 0 ? t : t.replace(/[^\s()/.]/g, (ch, i) => SCR[Math.floor(R.hash(i * 7.3 + f * 1.7 + seed * 91) * SCR.length)])]);
  }

  /* ---- Scroll ---- */
  const FREEZE = bar(7.5);
  const head = (p, u) => Math.floor(p.n0 + p.rate * Math.min(u, FREEZE) / 1.5);
  /** The visible lines of a streaming pane: [{src, idx}] top to bottom. */
  function visible(p, u) {
    const n = head(p, u);
    const out = [];
    for (let i = n - ROWS; i < n; i++) out.push({ src: p.lines[((i % p.lines.length) + p.lines.length) % p.lines.length], idx: i });
    return out;
  }

  /* ---- Blood: which glyphs are red, the drips, the pools ---- */
  const PROMPT_TXT = ' Do you want to proceed?';
  const redPrompt = [];
  for (let c = 1; c < PROMPT_TXT.length; c++) if (PROMPT_TXT[c] !== ' ') redPrompt.push(c);
  const promptOrder = redPrompt.map((c, i) => ({ c, k: R.hash(c * 3.1 + 4) })).sort((a, b) => a.k - b.k).map((o) => o.c);
  /** Red times for glyphs in the waiting pane: Map key "row:col" -> u. */
  const RED = new Map();
  promptOrder.forEach((c, i) => RED.set(PROMPT + ':' + c, bar(6) + 0.12 + i * bar(0.07)));
  RED.set(PROMPT + ':' + CURSOR_COL, bar(6));
  [[16, 0.9], [14, 0.8], [20, 0.75], [21, 0.5], [17, 0.45], [11, 0.4], [22, 0.4], [23, 0.4]].forEach(([row, dens], j) => {
    const s = R.plain(WAIT.lines[row]);
    for (let c = 0; c < s.length; c++) {
      if (s[c] === ' ' || s[c] === '─') continue;
      if (R.hash(row * 31.7 + c * 1.13) < dens) RED.set(row + ':' + c, bar(6.9) + j * bar(0.12) + R.hash(row + c * 5.3) * bar(0.8));
    }
  });

  const POOL_D = bar(0.9);
  const DROWN = [5, 4, 6, 1, 0, 2, 7, 3];
  const drownStart = (p) => (p.i === 5 ? bar(8) : bar(8.15) + (DROWN.indexOf(p.i) - 1) * bar(0.12));
  /** Pool level in px for pane p at time u. */
  function level(p, u) {
    if (p.i === 5) {
      let L = 3 + 9 * R.ramp(u, 0, bar(6)) + 110 * R.in2(R.ramp(u, bar(6), bar(8)));
      L += (PH - L) * R.in2(R.ramp(u, bar(8), bar(9)));
      return L;
    }
    return PH * R.in2(R.ramp(u, drownStart(p), drownStart(p) + POOL_D));
  }
  const floorOf = (p) => (u) => p.y + PH - level(p, u);

  // Drips: the cursor bleeds one drop per blink; melted letters drop more; in the drown every pane bleeds.
  const DRIPS = [];
  const cx = colX(WAIT, CURSOR_COL) + CW / 2;
  const cy = base(WAIT, PROMPT) + 3;
  const mk = (p, x, y0, t0, s) => ({ p, x, y0, t0, r: 4.4 + 2.0 * R.hash(s * 1.7), v: 17 + 13 * R.hash(s * 2.9), f: 0.45 + 0.5 * R.hash(s * 4.3), amp: 0.55 + 0.35 * R.hash(s * 5.9), seed: R.hash(s * 7.7) });
  DRIPS.push(Object.assign(mk(WAIT, cx, cy, -2.3, 1), { r: 9.5, v: 13, amp: 0.8 }));
  for (let k = 2; k < 26; k++) DRIPS.push(Object.assign(mk(WAIT, cx + (R.hash(k * 3.3) - 0.5) * 4, cy, k * 2 * BEAT + 0.02, 10 + k), { r: 6.5 + 2 * R.hash(k * 8.1) }));
  RED.forEach((t, key) => {
    const [row, col] = key.split(':').map(Number);
    if (col === CURSOR_COL) return;
    const n = R.hash(row * 7 + col * 13) < 0.35 ? 2 : 1;
    for (let j = 0; j < n; j++) DRIPS.push(mk(WAIT, colX(WAIT, col) + CW / 2 + (j ? 1.5 : 0), base(WAIT, row) + 2, t + 0.35 + R.hash(row + col * 2 + j) * 1.4 + j * 1.1, row * 100 + col + j * 0.5));
  });
  // Red glyphs elsewhere in the drown: chosen on each pane's frozen lines.
  const RED_OTHER = new Map();
  PANES.forEach((p) => {
    if (p.kind === 'wait') return;
    const lines = visible(p, FREEZE);
    const D0 = drownStart(p) - bar(0.55);
    let n = 0;
    for (let row = 0; row < ROWS && n < 14; row++) {
      const s = chantLine(lines[row].src, 3, 0).map((x) => x[1]).join('');
      for (let c = 2; c < Math.min(s.length, 50) && n < 14; c += 1) {
        if (s[c] === ' ') continue;
        if (R.hash(p.i * 101 + row * 17.3 + c * 2.1) < 0.045) {
          const t = D0 + R.hash(row * 3 + c) * bar(0.5);
          RED_OTHER.set(p.i + ':' + row + ':' + c, t);
          DRIPS.push(mk(p, colX(p, c) + CW / 2, base(p, row) + 2, t + 0.2 + R.hash(c + row) * 0.6, p.i * 1000 + row * 50 + c));
          n++;
        }
      }
    }
  });
  const isRed = (p, row, col, u) => {
    const t = p.kind === 'wait' ? RED.get(row + ':' + col) : RED_OTHER.get(p.i + ':' + row + ':' + col);
    return t != null && u >= t ? u - t : -1;
  };

  /* ---- Painting ---- */
  const ruleCol = '#ffffff2e';
  function chrome(ctx, p, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(p.x, p.y, PW, PH);
    ctx.fillStyle = '#141414';
    ctx.fillRect(p.x, p.y, PW, 28);
    ctx.fillStyle = '#ffffff12';
    ctx.fillRect(p.x, p.y + 28, PW, 1);
    ctx.fillStyle = '#3a3a3a';
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(p.x + 16 + k * 18, p.y + 14, 5.5, 0, Math.PI * 2); ctx.fill(); }
    R.text(ctx, p.title, p.x + PW / 2, p.y + 19, { font: '500 12.5px ' + R.SANS, align: 'center', fill: '#6b6b6b' });
    ctx.strokeStyle = '#ffffff1c';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, PW - 1, PH - 1);
  }
  /** Draws spans at a row; glyphs that have turned to blood are left out (blood.js draws them). */
  function row(ctx, p, sp, r, u, a, rowKey) {
    let col = 0;
    const y = base(p, r);
    ctx.font = FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.globalAlpha = a;
    for (const [c, t] of sp) {
      ctx.fillStyle = R.C[c] || R.C.n;
      for (let i = 0; i < t.length; i++, col++) {
        if (col > 51) return;
        const ch = t[i];
        if (ch === ' ') continue;
        if (rowKey != null && isRed(p, rowKey, col, u) >= 0) continue;
        ctx.fillText(ch, colX(p, col), y);
      }
    }
  }
  function spinner(u) { return '·✢✳✶✻✽✻✶✳✢'[Math.floor(u * 8) % 10]; }
  const mmss = (s) => { s = Math.floor(s); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; };

  function paintStream(ctx, p, u, a) {
    const c = chantAmt(p, u);
    const lines = visible(p, u);
    lines.forEach((ln, r) => {
      const h = R.hash(p.i * 13.1 + ln.idx * 0.773);
      const th = [h * 0.5, 0.22 + h * 0.5, 0.55 + h * 0.42];
      let st = 0;
      th.forEach((x, k) => { if (c > x) st = k + 1; });
      let sp = chantLine(ln.src, st, h);
      if (st > 0) {
        const tc = chantStart(p) + th[st - 1] * CH_D;
        if (u - tc < 0.14) sp = scramble(sp, u, h);
      }
      row(ctx, p, sp, r, u, a, u >= FREEZE ? r : null);
    });
    // Footer: the live line and the input.
    const fy = ROWS;
    const el = p.spin0 + u / 1.5;
    if (p.kind === 'claude') {
      const sp = c > 0.45 ? [['o', spinner(u) + " Fhtagn… (23m · esc to interrupt)"]] : [['o', spinner(u) + ' ' + p.spin + ' '], ['d', '(' + mmss(el) + ' · esc to interrupt)']];
      row(ctx, p, sp, fy, u, a);
      row(ctx, p, [['k', RULE]], fy + 1, u, a);
      row(ctx, p, [['d', '> ']], fy + 2, u, a);
      row(ctx, p, [['k', RULE]], fy + 3, u, a);
    } else {
      const sp = c > 0.45 ? [['d', "• Wgah'nagl (23m • esc to interrupt)"]] : [['d', '• Working (' + mmss(el) + ' • esc to interrupt)']];
      row(ctx, p, sp, fy, u, a);
      row(ctx, p, [['w', '› ']], fy + 2, u, a);
      row(ctx, p, [['d', '  ⏎ send   ⌃J newline   ⌃T transcript   ⌃C quit']], fy + 3, u, a);
    }
  }
  function paintWait(ctx, p, u, a) {
    WAIT.lines.forEach((s, r) => { if (s) row(ctx, p, R.spans(s), r, u, a, r); });
    // The block cursor after the question blinks on even beats.
    const on = Math.floor(u / BEAT + 1e-6) % 2 === 0;
    if (on && u < bar(6)) {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ededed';
      ctx.fillRect(colX(p, CURSOR_COL), base(p, PROMPT) - 13, CW, 17);
    }
  }
  /** Draws pane p (its contents at alpha a). */
  function paintPane(ctx, p, u, a) {
    chrome(ctx, p, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 1, p.y + 29, PW - 2, PH - 30);
    ctx.clip();
    if (p.kind === 'wait') paintWait(ctx, p, u, a); else paintStream(ctx, p, u, a);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function paintBlood(ctx, u) {
    ctx.globalCompositeOperation = 'lighter';
    // Melted glyphs.
    const g = (p, ch, r, c, age) => B.glyph(ctx, ch, colX(p, c), base(p, r), BFONT, R.clamp01(age / 2.2));
    RED.forEach((t, key) => {
      if (u < t) return;
      const [r, c] = key.split(':').map(Number);
      if (c === CURSOR_COL) {
        const age = u - t;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.fillRect(colX(WAIT, c), base(WAIT, PROMPT) - 13, CW, 17 + 6 * R.clamp01(age / 2));
        B.blob(ctx, colX(WAIT, c) + CW / 2, base(WAIT, PROMPT) + 5 + 7 * R.clamp01(age / 2), 4.2, 1.4, 1);
        return;
      }
      const ch = R.plain(WAIT.lines[r])[c];
      g(WAIT, ch, r, c, u - t);
    });
    if (u >= FREEZE) {
      RED_OTHER.forEach((t, key) => {
        if (u < t) return;
        const [pi, r, c] = key.split(':').map(Number);
        const p = PANES[pi];
        const ln = visible(p, u)[r];
        const h = R.hash(p.i * 13.1 + ln.idx * 0.773);
        const s = chantLine(ln.src, 3, h).map((x) => x[1]).join('');
        if (s[c] && s[c] !== ' ') g(p, s[c], r, c, u - t);
      });
    }
    // Drips, swallowed by their pane's pool.
    const impacts = PANES.map(() => []);
    for (const d of DRIPS) {
      if (u < d.t0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(d.p.x + 1, d.p.y + 29, PW - 2, PH - 30);
      ctx.clip();
      const st = B.drip(ctx, d, u, floorOf(d.p));
      ctx.restore();
      if (st && st.landed) impacts[d.p.i].push({ x: st.x, at: st.at });
    }
    // Pools, pane after pane; the last of the drown also covers the hairlines between panes.
    ctx.globalAlpha = 1;
    PANES.forEach((p) => B.pool(ctx, p.x, p.x + PW, p.y + PH, level(p, u), u, impacts[p.i], p.y));
    const all = R.ramp(u, bar(9.55), bar(9.85));
    if (all > 0) {
      ctx.globalAlpha = all;
      ctx.fillStyle = '#fff';
      ctx.fillRect(-200, -200, 2320, 1480);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  const KEYS = [
    { t: 0, s: 1, x: 960, y: 540 },
    { t: bar(2), s: 2.0, x: 840, y: 810, d: ZOOM },
    { t: bar(4), s: 1, x: 960, y: 540, d: ZOOM },
    { t: bar(5), s: 2.4, x: 1200, y: 300, d: ZOOM },
    { t: bar(6), s: 2.4, x: 740, y: 855, d: ZOOM },
    { t: bar(8), s: 1, x: 960, y: 540, d: ZOOM },
    { t: bar(8) + ZOOM, s: 1.06, x: 960, y: 548, d: bar(1.6) }
  ];
  const ZOOM_ENDS = [bar(2) + ZOOM, bar(4) + ZOOM, bar(5) + ZOOM, bar(6) + ZOOM, bar(8) + ZOOM];
  const focus = (u) => ZOOM_ENDS.reduce((m, z) => Math.max(m, 4.5 * R.bump(u, z - 0.15, 0.6)), 0) ;

  /** Paints act 1 at authored time u; returns the camcorder settings and the OSD state for that frame. */
  function paint(rec, u, opts) {
    const o = opts || {};
    rec.begin('#050505');
    const cam = R.camera(KEYS, u, ZOOM);
    R.apply(rec.ui, cam, u);
    R.apply(rec.blood, cam, u);
    PANES.forEach((p) => paintPane(rec.ui, p, u, 1));
    paintBlood(rec.blood, u);
    return {
      fx: { grade: 0.88, focus: focus(u) + (o.focus || 0), bloodOn: 1 },
      clock: 3 * 3600 + 17 * 60 + 6 + u / 1.5,
      readout: R.ramp(u, bar(2.3), bar(2.35)) * (1 - R.ramp(u, bar(3.9), bar(3.95)))
    };
  }
  /** The 23:00 readout over the zoomed pane (OSD layer). */
  function readout(ctx, a) {
    if (!ctx || a <= 0) return;
    R.osdText(ctx, 'NO INPUT SINCE 02:54', 1270, 560, 34, 'left', a);
    R.osdText(ctx, '23:00', 1252, 760, 190, 'left', a);
  }

  window.Night = { BAR, BEAT, bar, PANES, WAIT, paint, paintPane, readout, level, visible, X0, Y0, base, colX, CW, LH, FONT, PROMPT, CURSOR_COL, ROWS, RULE, PW, PH };
})();
