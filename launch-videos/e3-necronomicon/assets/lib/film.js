/* Film E3's script: the camera for the whole film (film seconds, so every seam matches), the book's heights per
   spread, and one painter per page. A painter takes a Folio sheet and the film time and draws that page as it is
   at that moment. SPEC.md is the brief; times here are film seconds (the music's beat is 1.000 s, a bar 4.000 s). */
(function () {
  const F = window.Folio;
  const P = window.Plates;
  const { MAT, E, ramp, clamp01, lerp, mulberry32 } = F;
  const PW = P.PW; const PH = P.PH;

  /* ---- Heights of the two page blocks for each spread (they trade thickness as leaves turn) ---- */
  const TOPS = {
    closed: { left: 0, right: 0.075 },
    s1: { left: F.BOARD + 0.004, right: 0.07 },
    s2: { left: F.BOARD + 0.008, right: 0.066 },
    s3: { left: F.BOARD + 0.012, right: 0.062 },
    s4: { left: F.BOARD + 0.016, right: 0.058 },
    s5: { left: F.BOARD + 0.02, right: 0.054 },
    s6: { left: F.BOARD + 0.024, right: 0.05 }
  };

  /* ---- Page-texture point → world (for the camera and props) ---- */
  const wx = (side, px) => (side > 0 ? px / PW : -1 + px / PW) * F.W;
  const wz = (py) => -F.H / 2 + (py / PH) * F.H;

  /* ---- The camera: [filmT, tx, tz, dist, pitch, yaw, ty, ease-into-key] ---- */
  const EYE1 = { x: 175, y: 330 };
  const PUPIL3 = { x: 600, y: 880 };
  F.camKeys([
    [0.0, 0.53, -0.07, 1.25, 84, 0, 0.1],
    [1.0, 0.53, -0.07, 1.18, 84, 0, 0.1, 'io2'],
    [3.6, 0.53, -0.06, 1.4, 80, 0, 0.1, 'io2'],
    [4.2, 0.5, -0.04, 1.6, 78, 0, 0.09, 'io2'],
    [5.7, -0.12, 0.04, 2.45, 64, 0, 0.05, 'io2'],
    [8.0, -0.48, 0.02, 2.2, 70, 0, 0.04, 'io2'],
    [11.0, -0.47, 0.0, 2.1, 71, 0, 0.04, 'io2'],
    [12.0, 0.5, 0.02, 2.15, 72, 0, 0.07, 'io2'],
    [14.6, 0.5, 0.06, 2.0, 74, 0, 0.07, 'io2'],
    [15.0, 0.52, 0.22, 1.5, 80, 0, 0.07, 'io2'],
    [15.99, wx(1, 690), wz(1300), 0.07, 89, 0, 0.07, 'in3'],
    [16.0, wx(1, 690), wz(1300), 0.07, 89, 0, 0.066],
    [16.85, 0.0, 0.02, 2.1, 68, 0, 0.05, 'expo'],
    [19.2, 0.0, 0.02, 2.0, 69, 0, 0.05, 'io2'],
    [20.0, -0.02, 0.02, 2.1, 69, 0, 0.05, 'io2'],
    [23.0, -0.08, 0.0, 2.15, 70, 0, 0.05, 'io2'],
    [23.99, wx(-1, PUPIL3.x), wz(PUPIL3.y), 0.035, 89, 0, TOPS.s3.left, 'in3'],
    [24.0, wx(-1, EYE1.x), wz(EYE1.y), 0.035, 89, 0, TOPS.s4.left],
    [24.6, wx(-1, EYE1.x + 10), wz(EYE1.y + 40), 0.5, 84, 0, TOPS.s4.left, 'expo'],
    [25.3, wx(-1, EYE1.x + 10), wz(EYE1.y + 46), 0.5, 84, 0, TOPS.s4.left, 'io2'],
    [26.2, 0.0, 0.03, 2.35, 62, 0, 0.04, 'io2'],
    [30.4, 0.0, 0.03, 2.1, 64, 0, 0.04, 'io2'],
    [31.2, 0.0, 0.02, 2.2, 66, 0, 0.04, 'io2'],
    [32.0, -0.02, 0.02, 2.25, 66, 0, 0.04, 'io2'],
    [33.8, -0.06, 0.02, 2.15, 68, 0, 0.04, 'io2'],
    [34.6, 0.5, 0.06, 1.9, 74, 0, 0.05, 'io2'],
    [38.6, 0.5, 0.08, 1.85, 75, 0, 0.05, 'io2'],
    [39.3, 0.0, 0.02, 2.25, 66, 0, 0.04, 'io2'],
    [40.0, 0.0, 0.02, 2.25, 66, 0, 0.04, 'io2'],
    [41.0, 0.36, 0.0, 2.0, 70, 0, 0.05, 'io2'],
    [44.0, 0.53, -0.02, 1.45, 76, 0, 0.05, 'io2'],
    [47.8, 0.531, -0.023, 1.2, 80, 0, 0.05, 'out2'],
    [52.0, 0.531, -0.023, 1.2, 80, 0, 0.05, 'io2']
  ]);

  /* ---- Shared timing helpers ---- */
  /** A leaf turn from t0 over d seconds: power2.inOut on the angle. */
  const turn = (t, t0, d) => Math.PI * E.io2(ramp(t, t0, t0 + (d || 0.8)));
  /** "Takes the ink" over 0.13 s from t0. */
  const ink = (t, t0) => E.out2(ramp(t, t0, t0 + 0.13));

  /* ---- Cached page grounds: a sheet's static part painted once, restored every frame ---- */
  function cache(sh) {
    const mk = (cv) => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); return c; };
    sh._cache = [mk(sh.cc), mk(sh.hc), mk(sh.rc)];
  }
  function restore(sh) {
    const [a, b, c] = sh._cache;
    const put = (ctx, cv, src) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(src, 0, 0); ctx.restore(); void cv; };
    put(sh.c, sh.cc, a); put(sh.hx, sh.hc, b); put(sh.rx, sh.rc, c);
  }
  /** A page with a static ground (paintStatic once) and a per-frame overlay keyed by key(t). */
  function page(seed, paintStatic, dyn) {
    const sh = new F.Sheet();
    sh.vellum(seed);
    if (paintStatic) paintStatic(sh);
    cache(sh);
    sh.commit();
    sh.frame = (t) => {
      if (!dyn) return sh;
      const k = dyn.key(t);
      if (k === sh.key) return sh;
      sh.key = k;
      restore(sh);
      dyn.paint(sh, t);
      sh.commit();
      return sh;
    };
    return sh;
  }
  const q = (x, n) => Math.round(clamp01(x) * (n || 30));

  /* ============================== the binding ============================== */
  function boards() {
    const sh = new F.Sheet();
    P.flesh(sh, 3, { seams: [[[0, 520], [420, 600], [800, 470], [1280, 560]]] });
    sh.commit();
    return sh;
  }

  /* ============================== 1 · the cover ============================== */
  const COVER_EYE = { x: 640, y: 830, w: 560 };
  const STITCH_T = [0.25, 0.42, 0.52, 0.6, 0.68, 0.76, 0.85];
  function coverSheet() {
    const sh = new F.Sheet();
    P.flesh(sh, 11, {
      seams: [
        [[0, 300], [260, 360], [520, 280], [820, 330], [1280, 250]],
        [[880, 0], [930, 260], [1010, 330]],
        [[0, 1430], [300, 1380], [640, 1470], [980, 1400], [1280, 1460]],
        [[300, 1380], [260, 1600], [330, 1818]]
      ],
      studs: [[110, 110], [1170, 110], [110, 1708], [1170, 1708]]
    });
    // blind-tooled frame: two pressed rules
    sh.layer({ col: 'rgba(12,4,3,0.55)', hgt: 70 }, (c) => { c.lineWidth = 6; c.strokeRect(70, 70, PW - 140, PH - 140); c.lineWidth = 3; c.strokeRect(96, 96, PW - 192, PH - 192); });
    // old blood: it has wept from the stitch holes before, and dried in runs down the cover
    [[1, 300], [3, 520], [4, 210], [6, 380]].forEach(([i, len]) => {
      const u = (i + 0.5) / STITCH_T.length;
      const sx = COVER_EYE.x - COVER_EYE.w * 0.42 + u * COVER_EYE.w * 0.84 + 12;
      const sy = COVER_EYE.y + Math.sin(u * Math.PI) * COVER_EYE.w * 0.04 + 22;
      sh.layer({ col: '#4a0404', hgt: 190, rgh: 55, blurH: 2, alpha: 0.95 }, (c) => {
        const w = 9; c.beginPath(); c.moveTo(sx - w / 2, sy);
        c.bezierCurveTo(sx - w, sy + len * 0.4, sx + 8 - w * 0.3, sy + len * 0.7, sx + 6, sy + len);
        c.arc(sx + 6, sy + len, w * 0.7, Math.PI, 0, true);
        c.bezierCurveTo(sx + 8 + w * 0.3, sy + len * 0.7, sx + w * 0.6, sy + len * 0.4, sx + w / 2, sy); c.closePath(); c.fill();
      });
    });
    cache(sh);
    sh.frame = (t) => {
      const open = E.out3(ramp(t, 1.0, 1.32));
      const key = q(open, 40) + ':' + STITCH_T.map((s) => q(ramp(t, s, s + 0.25), 10)).join('') + ':' + Math.floor(t * 30);
      if (key === sh.key) return sh;
      sh.key = key;
      restore(sh);
      const { x, y, w } = COVER_EYE;
      // swollen lids: the eye bulges against the thread before it tears
      const strain = Math.sin(Math.min(1, t / 1.0) * Math.PI * 0.5) * (1 - open);
      sh.layer({ col: 'rgba(110,50,40,' + (0.15 + 0.2 * strain).toFixed(3) + ')', hgt: 200, blurC: 40, blurH: 30 }, (c) => { c.beginPath(); c.ellipse(x, y, w * 0.62, w * 0.3, 0, 0, 7); c.fill(); });
      // saccades: left, right, then at us (3 frames each move)
      const look = (tt) => {
        const keys = [[1.0, 0, 0], [1.7, -0.9, 0.1], [2.25, 0.85, -0.15], [2.85, 0.1, 0.25], [3.4, 0, 0]];
        let lx = 0; let ly = 0;
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i]; const prev = keys[Math.max(0, i - 1)];
          const m = E.out3(ramp(tt, k[0], k[0] + 0.1));
          if (tt >= k[0]) { lx = lerp(prev[1], k[1], m); ly = lerp(prev[2], k[2], m); }
        }
        return [lx, ly];
      };
      const [lx, ly] = look(t);
      P.eye(sh, x, y, w, { open, lx, ly, pupil: 1 - E.out3(ramp(t, 1.0, 1.4)) * 0.75, seed: 3, lid: '#331713' });
      // the seven stitches across the lid seam, each snapping at its time and bleeding
      STITCH_T.forEach((s, i) => {
        const u = (i + 0.5) / STITCH_T.length;
        const sx = x - w * 0.42 + u * w * 0.84;
        const sy = y + Math.sin(u * Math.PI) * w * 0.04;
        const tear = ramp(t, s, s + 0.18);
        const dy = open * w * 0.22 * Math.sin(u * Math.PI);
        if (tear < 1 || open < 0.05) P.stitch(sh, sx, sy, Math.PI / 2, 46, 1, tear);
        else {
          // torn ends hang from both lids
          P.stitch(sh, sx, sy - dy, Math.PI / 2, 30, 1, 1);
          P.stitch(sh, sx, sy + dy * 0.7, Math.PI / 2, 30, 1, 1);
        }
        P.beads(sh, sx - 14, sy - 22 - dy, 9, 40 + i, ramp(t, s + 0.05, s + 0.45), i % 3 === 0 ? ramp(t, s + 0.4, s + 2.2) : 0);
        P.beads(sh, sx + 12, sy + 20 + dy * 0.7, 8, 60 + i, ramp(t, s + 0.08, s + 0.5), i % 2 === 0 ? ramp(t, s + 0.3, s + 2.4) : 0);
      });
      sh.commit();
      return sh;
    };
    sh.frame(0);
    return sh;
  }

  /* ============================== 2 · plate I, the tree of worktrees ============================== */
  const TREE = (() => {
    const cx = 600; const S = [cx, 1150]; const J = [cx, 570];
    const rnd = mulberry32(5);
    const trunk = P.bez([cx, 1440], [cx - 16, 1360], [cx + 14, 1230], S, 40);
    const crown = P.bez(J, [cx - 30, 480], [cx + 60, 420], [cx + 8, 372], 40);
    // the crown curls into a spiral
    const C0 = [cx + 8 + 32, 372];
    for (let i = 1; i <= 40; i++) { const a = Math.PI + (i / 40) * Math.PI * 3.2; const r = 32 * (1 - (i / 40) * 0.8); crown.push([C0[0] + Math.cos(a) * r, C0[1] + Math.sin(a) * r]); }
    const tendrils = [-330, -215, -100, 100, 215, 330].map((dx, i) => {
      const pts = P.bez(S, [S[0] + dx * 0.85, S[1] - 130], [S[0] + dx * 1.12, J[1] + 170], J, 70);
      const ph = rnd() * 6; const amp = 10 + rnd() * 10;
      return pts.map((p, j) => { const u = j / 70; const w = Math.sin(u * Math.PI); return [p[0] + Math.sin(u * 16 + ph) * amp * w, p[1] + Math.cos(u * 11 + ph) * amp * 0.4 * w]; });
    });
    const roots = [-250, -160, -80, 80, 170, 260].map((dx, i) => P.bez([cx, 1430], [cx + dx * 0.3, 1450], [cx + dx * 0.8, 1470 + (i % 2) * 20], [cx + dx, 1500 + (i % 3) * 14], 24));
    return { cx, S, J, trunk, crown, tendrils, roots };
  })();
  /** g: 0..1 growth. Trunk 0-0.25, tendrils 0.25-0.75 (staggered), crown 0.75-1. */
  function paintTree(sh, g) {
    const kT = ramp(g, 0, 0.25); const kC = ramp(g, 0.75, 1);
    sh.layer(MAT.ink, (c) => {
      TREE.roots.forEach((r) => P.tube(c, r, (u) => 12 * (1 - u) + 1.5, ramp(g, 0.02, 0.2), { clw: 2.4, step: 2 }));
      P.tube(c, TREE.trunk, (u) => 30 - u * 6, kT, { clw: 3.2, rings: 5, step: 1 });
      TREE.tendrils.forEach((pts, i) => P.tube(c, pts, (u) => 7 + 10 * Math.sin(Math.PI * u), ramp(g, 0.25 + i * 0.025, 0.62 + i * 0.025), { clw: 2.6, rings: 7, suckers: 6, suckerSide: i < 3 ? 1 : -1, step: 2 }));
      P.tube(c, TREE.crown, (u) => 24 * (1 - u) + 2, kC, { clw: 3, rings: 5, step: 1 });
    });
    // where the tendrils leave and rejoin the trunk: two engraved knots
    if (g > 0.25) sh.layer(MAT.ink, (c) => { c.lineWidth = 2.5; c.beginPath(); c.ellipse(TREE.S[0], TREE.S[1], 34, 16, 0, 0, 7); c.stroke(); });
    if (g > 0.74) sh.layer(MAT.ink, (c) => { c.lineWidth = 2.5; c.beginPath(); c.ellipse(TREE.J[0], TREE.J[1], 30, 14, 0, 0, 7); c.stroke(); });
  }
  function treePlateStatic(sh) {
    const cx = 600; const cy = 900; const rx = 440; const ry = 640;
    const oval = (c) => c.ellipse(cx, cy, rx - 20, ry - 20, 0, 0, Math.PI * 2);
    sh.layer(MAT.inkSoft, (c) => {
      P.hatch(c, oval, 0, 13, 1.1, [cx - rx, cy - ry, cx + rx, cy + ry], 2);
      // the ground: denser lines under the roots
      c.save(); c.beginPath(); oval(c); c.clip(); P.hatch(c, (x) => { x.rect(cx - rx, 1450, rx * 2, 200); }, 0, 6, 1.3, [cx - rx, 1450, cx + rx, 1650]); c.restore();
    });
    sh.layer({ col: '#0d0a08', blurC: 20 }, (c) => { c.beginPath(); c.ellipse(cx, 860, 330, 480, 0, 0, 7); c.fill(); });
    P.frameOval(sh, cx, cy, rx, ry);
  }
  /** The tree's growth across film time (SPEC: trunk from 6.6, split at 9.0, rejoined by 10.4, crown by 11.0). */
  const treeG = (t) => (t < 9 ? 0.25 * E.io2(ramp(t, 5.8, 9.0)) : t < 10.4 ? 0.25 + 0.5 * ramp(t, 9.0, 10.4) : 0.75 + 0.25 * E.out2(ramp(t, 10.4, 11.0)));
  function treePage() {
    return page(21, treePlateStatic, { key: (t) => q(treeG(t), 120), paint: (sh, t) => paintTree(sh, treeG(t)) });
  }

  /* ---- right page I: Branch out. Merge in. ---- */
  function ruleBranchPage() {
    return page(22, null, {
      key: (t) => [q(ink(t, 12.0), 8), q(ink(t, 13.0), 8), q(ink(t, 13.5), 8), q(ramp(t, 14.0, 14.12), 4), q(ramp(t, 14.12, 14.62), 20), q(ramp(t, 14.6, 14.75), 6)].join(','),
      paint: (sh, t) => {
        P.rule(sh, ['Branch out.'], 680, 520, 150, { a: [ink(t, 12.0)] });
        P.rule(sh, ['Merge in.'], 680, 720, 150, { a: [ink(t, 13.0)] });
        const a3 = ink(t, 13.5);
        sh.layer(Object.assign({}, MAT.ink, { alpha: a3 }), (c) => { c.lineWidth = 2; c.beginPath(); c.moveTo(580, 845); c.lineTo(780, 845); c.stroke(); });
        P.caps(sh, 'EACH AGENT RUNS ON ITS', 680, 960, 52, a3);
        P.caps(sh, 'OWN GIT WORKTREE', 680, 1036, 52, a3);
        const fall = ramp(t, 14.0, 14.12);
        if (fall >= 1) P.seal(sh, 690, 1300, 150, 7, ramp(t, 14.12, 14.62), E.out3(ramp(t, 14.6, 14.75)), P.SIGILS.fork);
        else P.bloodDrop(sh, 690, 1300, 150, 7, fall, 0);
      }
    });
  }

  /* ============================== 3 · plate II, the casket ============================== */
  function casketStatic(sh) {
    P.frameRect(sh, 110, 230, 980, 1360);
    const A = [190, 960]; const B = [900, 960]; const D = [170, -140];
    const C = [900, 1300]; const Dd = [190, 1300];
    const B2 = [B[0] + D[0], B[1] + D[1]]; const A2 = [A[0] + D[0], A[1] + D[1]]; const C2 = [C[0] + D[0], C[1] + D[1]];
    const poly = (pts) => (c) => { c.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach((p) => c.lineTo(p[0], p[1])); c.closePath(); };
    const box = [126, 246, 1074, 1574];
    sh.layer(MAT.inkSoft, (c) => {
      // the dark room: sparse horizontal lines; the floor: denser
      P.hatch(c, (x) => x.rect(126, 246, 948, 1328), 0, 15, 1.0, box);
      P.hatch(c, (x) => x.rect(126, 1200, 948, 374), 0, 8, 1.2, box, 1.5);
    });
    // the casket's cast shadow (to the right, away from the candle): erase the floor lines there
    sh.layer({ col: '#0d0a08', hgt: 120 }, (c) => { c.beginPath(); poly([C, [C[0] + 260, C[1] - 10], [C2[0] + 240, C2[1] + 40], C2])(c); c.fill(); });
    sh.layer({ col: '#0d0a08' }, (c) => { c.beginPath(); poly([A, B, C, Dd])(c); poly([A, A2, B2, B])(c); poly([B, B2, C2, C])(c); c.fill(); });
    sh.layer(MAT.ink, (c) => {
      P.hatch(c, poly([A, A2, B2, B]), Math.atan2(D[1], D[0]), 5, 1.4, box); // lid: lit, densest
      P.hatch(c, poly([A, B, C, Dd]), Math.PI / 2, 7, 1.3, box); // front
      P.hatch(c, poly([[A[0], 1010], [B[0], 1010], C, Dd]), 0.15, 11, 1.0, box); // front, lower: cross
      P.hatch(c, poly([B, B2, C2, C]), Math.PI / 2 + 0.2, 13, 1.0, box); // side: in shadow, sparse
      c.lineWidth = 4; c.lineJoin = 'round';
      [[A, B, C, Dd], [A, A2, B2, B], [B, B2, C2, C]].forEach((p) => { c.beginPath(); poly(p)(c); c.stroke(); });
      // the lid's lip and iron straps
      c.lineWidth = 3; c.beginPath(); c.moveTo(A[0], 1015); c.lineTo(B[0], 1015); c.lineTo(B[0] + 40, 984); c.stroke();
      [330, 760].forEach((sx) => { c.lineWidth = 2.5; c.strokeRect(sx - 18, 960, 36, 340); P.hatch(c, (x) => x.rect(sx - 18, 960, 36, 340), 0, 5, 1.2, box); });
    });
    // the chains: links along two crossing paths
    const chain = (p0, p1, p2) => {
      const pts = P.bez(p0, p1, p1, p2, 60); const L = P.polyLen(pts); const n = Math.floor(L / 30);
      sh.layer(MAT.ink, (c) => {
        let acc = 0; let k = 0; let next = 0;
        for (let i = 1; i < pts.length && k < n; i++) {
          const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc += d;
          if (acc < next) continue;
          next += 30;
          const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
          c.save(); c.translate(pts[i][0], pts[i][1]); c.rotate(a);
          c.lineWidth = 3;
          if (k % 2 === 0) { c.beginPath(); c.ellipse(0, 0, 22, 12, 0, 0, 7); c.stroke(); c.lineWidth = 1.2; c.beginPath(); c.ellipse(0, 3, 14, 5, 0, 0, Math.PI); c.stroke(); } else { c.beginPath(); c.moveTo(-20, 0); c.lineTo(20, 0); c.stroke(); }
          c.restore(); k++;
        }
      });
    };
    chain([A2[0] - 30, A2[1] + 40], [560, 1080], [930, 1320]);
    chain([B2[0] + 10, B2[1] + 30], [600, 1090], [170, 1330]);
    // the padlock
    sh.layer({ col: '#0d0a08' }, (c) => { c.beginPath(); c.roundRect(480, 1110, 130, 112, 14); c.fill(); });
    sh.layer(MAT.ink, (c) => {
      c.lineWidth = 9; c.beginPath(); c.arc(545, 1110, 44, Math.PI, 0); c.stroke();
      c.lineWidth = 4; c.beginPath(); c.roundRect(480, 1110, 130, 112, 14); c.stroke();
      P.hatch(c, (x) => x.roundRect(480, 1110, 130, 112, 14), 0.5, 5, 1.2, [480, 1110, 610, 1222]);
      c.fillStyle = '#0d0a08'; c.beginPath(); c.arc(545, 1152, 13, 0, 7); c.fill(); c.fillRect(539, 1152, 12, 34);
    });
    // the path engraved on the lid, in a cartouche (set upright so it reads)
    const lidMid = [(A[0] + B[0] + A2[0] + B2[0]) / 4, (A[1] + B[1] + A2[1] + B2[1]) / 4 + 4];
    sh.layer({ col: '#0d0a08', hgt: 100 }, (c) => { c.beginPath(); c.roundRect(lidMid[0] - 345, lidMid[1] - 44, 690, 74, 10); c.fill(); });
    sh.layer(MAT.ink, (c) => {
      c.lineWidth = 2; c.beginPath(); c.roundRect(lidMid[0] - 345, lidMid[1] - 44, 690, 74, 10); c.stroke();
      c.font = '600 56px ' + P.BOD; c.textAlign = 'center'; c.fillText('~/.claude/settings.json', lidMid[0], lidMid[1] + 14);
    });
  }
  /** The red flood draining: k 0 = every pixel blood, 1 = all gone; streaks lag behind the falling edge. */
  function flood(sh, k, seed, sideX) {
    if (k >= 1) return;
    const rnd = mulberry32(seed);
    const base = (k * 1.45 - 0.2) * PH;
    const body = (c) => {
      c.beginPath(); c.moveTo(0, PH + 50);
      for (let x = 0; x <= PW; x += 16) { const y = base + Math.sin((x + sideX) * 0.013) * 40 + Math.sin((x + sideX) * 0.041) * 18; c.lineTo(x, y); }
      c.lineTo(PW, PH + 50); c.closePath(); c.fill();
      for (let i = 0; i < 26; i++) {
        const x = rnd() * PW; const w = 6 + rnd() * 26; const lag = (0.08 + rnd() * 0.3) * PH * (1 - k * 0.6);
        const top = base - lag; c.beginPath(); c.moveTo(x - w / 2, base + 20); c.lineTo(x - w * 0.3, top + w); c.arc(x, top + w, w * 0.32, Math.PI, 0); c.lineTo(x + w / 2, base + 20); c.closePath(); c.fill();
      }
    };
    sh.layer({ col: '#5e0202', hgt: 232, rgh: 16, blurH: 4 }, body);
    // the film is uneven: thicker runs catch the candle as moving streaks
    const r2 = mulberry32(seed + 5);
    sh.layer({ col: '#3e0000', hgt: 252, rgh: 10, blurH: 14, blurC: 20, alpha: 0.9 }, (c) => {
      c.save(); c.beginPath(); body(c); c.clip();
      for (let i = 0; i < 40; i++) { const x = r2() * PW; const y = r2() * PH; c.beginPath(); c.ellipse(x, y + (1 - k) * 0, 30 + r2() * 90, 80 + r2() * 260, 0, 0, 7); c.fill(); }
      c.restore();
    });
  }
  const floodK = (t) => E.io2(ramp(t, 16.0, 16.85));
  function casketPage() {
    return page(31, casketStatic, { key: (t) => q(floodK(t), 40), paint: (sh, t) => flood(sh, floodK(t), 3, 0) });
  }
  function ruleConfigPage() {
    return page(32, null, {
      key: (t) => [q(floodK(t), 40), q(ink(t, 16.8), 6), q(ink(t, 17.3), 6), q(ink(t, 18.0), 6), q(ramp(t, 18.5, 18.95), 16), q(ramp(t, 18.9, 19.05), 6)].join(','),
      paint: (sh, t) => {
        P.rule(sh, ['Touch not', 'the config'], 690, 430, 140, { a: [ink(t, 16.8), ink(t, 16.8)], versal: true });
        P.rule(sh, ['of thy fathers.'], 690, 430 + 2 * 157, 140, { a: [ink(t, 17.3)], versal: false });
        P.caps(sh, 'HANDS OFF YOUR CONFIG', 690, 940, 54, ink(t, 18.0));
        P.seal(sh, 690, 1290, 140, 12, ramp(t, 18.5, 18.95), E.out3(ramp(t, 18.9, 19.05)), P.SIGILS.lock);
        flood(sh, floodK(t), 4, 1280);
      }
    });
  }

  /* ============================== 4 · plate III, the eye ============================== */
  function eyePlateStatic(sh) {
    P.frameRect(sh, 110, 230, 980, 1360);
    const { x: cx, y: cy } = PUPIL3; const w = 900; const h = 300;
    const box = [126, 246, 1074, 1574];
    const lidClip = (c) => P.almond(c, cx, cy, w, h);
    sh.layer(MAT.inkSoft, (c) => {
      c.save(); c.beginPath(); c.rect(126, 246, 948, 1328); P.almond(c, cx, cy, w * 1.12, h * 1.6); c.clip('evenodd');
      P.hatch(c, (x) => x.rect(126, 246, 948, 1328), 0, 11, 1.1, box);
      c.restore();
    });
    sh.layer(MAT.ink, (c) => {
      // lids: contour lines that follow the lid edges outward
      c.lineWidth = 1.5;
      for (let i = 1; i <= 14; i++) {
        const k = 1 + i * 0.075;
        c.beginPath(); c.moveTo(cx - w / 2 * (1 + i * 0.015), cy); c.bezierCurveTo(cx - w * 0.22, cy - h * 1.05 * k, cx + w * 0.22, cy - h * 1.05 * k, cx + w / 2 * (1 + i * 0.015), cy); c.stroke();
        if (i <= 9) { c.beginPath(); c.moveTo(cx - w / 2 * (1 + i * 0.01), cy); c.bezierCurveTo(cx - w * 0.22, cy + h * 0.85 * k, cx + w * 0.22, cy + h * 0.85 * k, cx + w / 2 * (1 + i * 0.01), cy); c.stroke(); }
      }
      // the brow: short hairs along an arc
      c.lineWidth = 2.2;
      for (let i = 0; i < 110; i++) {
        const u = i / 110; const x = cx - w * 0.5 + u * w; const y = cy - h * 2.05 - Math.sin(u * Math.PI) * h * 0.55 + Math.sin(i * 7.1) * 6;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 26 + Math.sin(i) * 6, y - 12 - Math.cos(i * 3.3) * 6); c.stroke();
      }
      // sclera: curved lines, denser toward the corners
      c.save(); c.beginPath(); lidClip(c); c.clip();
      c.lineWidth = 1.3;
      for (let i = -12; i <= 12; i++) { c.beginPath(); c.ellipse(cx, cy + i * 2, w * 0.5, Math.abs(i) * 12 + 6, 0, 0, Math.PI * 2); c.stroke(); }
      // iris: radial lines, two limbal rings; the pupil left empty, a catchlight left solid
      const ir = 210; const pr = 95;
      c.fillStyle = '#0d0a08'; c.beginPath(); c.arc(cx, cy, ir + 6, 0, 7); c.fill();
      c.lineWidth = 1.7;
      c.beginPath();
      for (let i = 0; i < 240; i++) { const a = (i / 240) * Math.PI * 2; const r1 = ir * (0.86 + 0.1 * Math.sin(i * 1.9)); c.moveTo(cx + Math.cos(a) * pr * 1.04, cy + Math.sin(a) * pr * 1.04); c.lineTo(cx + Math.cos(a + 0.04) * r1, cy + Math.sin(a + 0.04) * r1); }
      c.stroke();
      c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, ir, 0, 7); c.stroke();
      c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, ir - 14, 0, 7); c.stroke();
      c.restore();
      c.beginPath(); c.ellipse(cx - 52, cy - 50, 30, 22, -0.5, 0, 7); c.fill();
      // lid margins and lashes
      c.lineWidth = 5; c.beginPath(); lidClip(c); c.stroke();
      c.lineWidth = 2.6;
      for (let i = 1; i < 44; i++) {
        const u = i / 44; const x = cx - w / 2 + u * w; const y = cy - h * 4 * u * (1 - u) * 0.79;
        const a = -Math.PI / 2 + (u - 0.5) * 2.0; const L = 80 + 40 * Math.sin(u * Math.PI);
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * L * 0.4, y + Math.sin(a) * L * 0.7, x + Math.cos(a) * L * 0.85 + (u - 0.5) * 40, y + Math.sin(a) * L * 0.85);
        c.stroke();
      }
      for (let i = 1; i < 26; i++) {
        const u = i / 26; const x = cx - w / 2 + u * w; const y = cy + h * 4 * u * (1 - u) * 0.64;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (u - 0.5) * 30, y + 34 + 10 * Math.sin(u * Math.PI)); c.stroke();
      }
    });
  }
  function eyePlatePage() { return page(41, eyePlateStatic, null); }
  function ruleAccountPage() {
    return page(42, null, {
      key: (t) => [q(ink(t, 21.0), 6), q(ink(t, 22.0), 6), q(ramp(t, 22.5, 22.95), 16), q(ramp(t, 22.9, 23.05), 6)].join(','),
      paint: (sh, t) => {
        P.rule(sh, ['No account.'], 690, 560, 150, { a: [ink(t, 21.0)] });
        P.rule(sh, ['No telemetry.'], 690, 760, 150, { a: [ink(t, 22.0)] });
        P.seal(sh, 690, 1240, 140, 21, ramp(t, 22.5, 22.95), E.out3(ramp(t, 22.9, 23.05)), P.SIGILS.shut);
      }
    });
  }

  /* ============================== 5 · the ten that wait ============================== */
  const EYE_Y = [330, 620, 910, 1200, 1490];
  const NAIL_T = (k) => 26.5 + 0.4 * k; // left column top→bottom (k 0-4), then right (5-9)
  const EYE_W = 230;
  function eyesState(t, k, seed) {
    const n = NAIL_T(k);
    const shut = t >= n;
    // waiting eyes drift their gaze slowly, then all snap to the camera when ⌘J lands
    const ph = seed * 1.7;
    const atUs = E.out3(ramp(t, 26.0, 26.1));
    const lx = lerp(Math.sin(t * 0.8 + ph) * 0.5, 0, atUs); const ly = lerp(Math.cos(t * 0.6 + ph) * 0.3, 0.1, atUs);
    return { open: shut ? 0 : 1, lx, ly, pupil: 0.4 + 0.2 * Math.sin(t * 1.3 + ph), seed, shut, n };
  }
  function eyesPage(side) {
    const ex = side < 0 ? 175 : 1105;
    const base = (sh) => {
      EYE_Y.forEach((y) => {
        P.ital(sh, 'Do you want', ex, y + 118, 34, 1);
        P.ital(sh, 'to proceed?', ex, y + 156, 34, 1);
      });
      // the margin rule that separates the eyes from the text block
      const rx = side < 0 ? 320 : 960;
      sh.layer(MAT.inkSoft, (c) => { c.lineWidth = 1.6; c.beginPath(); c.moveTo(rx, 220); c.lineTo(rx, 1620); c.stroke(); c.beginPath(); c.moveTo(rx + (side < 0 ? 10 : -10), 220); c.lineTo(rx + (side < 0 ? 10 : -10), 1620); c.stroke(); });
      if (side < 0) {
        P.rule(sh, ['Do you want', 'to proceed?'], 730, 760, 132, { lead: 1.2 });
      } else {
        P.caps(sh, 'JUMPS TO THE AGENT', 520, 1190, 50, 1);
        P.caps(sh, 'WAITING ON YOU', 520, 1262, 50, 1);
      }
    };
    return page(side < 0 ? 51 : 52, base, {
      key: (t) => {
        const parts = [Math.floor(t * 15)];
        for (let i = 0; i < 5; i++) parts.push(q(ramp(t, NAIL_T(i + (side < 0 ? 0 : 5)), NAIL_T(i + (side < 0 ? 0 : 5)) + 0.6), 12));
        if (side > 0) parts.push(q(ramp(t, 25.95, 26.2), 10));
        return parts.join(',');
      },
      paint: (sh, t) => {
        if (side > 0) {
          // ⌘J in blood: the glyph drawn wet, the J a blackletter capital
          const a = ramp(t, 25.95, 26.05);
          if (a > 0) {
            const k = E.expo(ramp(t, 25.95, 26.2));
            sh.layer(Object.assign({}, MAT.blood, { alpha: a }), (c) => { c.lineCap = 'round'; P.cmdGlyph(c, 380, 820, 150 * (0.92 + 0.08 * k), 30); });
            sh.layer(Object.assign({}, MAT.blood, { alpha: a }), (c) => { c.font = 420 * (0.94 + 0.06 * k) + 'px ' + P.FRAK; c.textAlign = 'left'; c.fillText('J', 560, 960); });
            P.beads(sh, 380, 990, 12, 77, ramp(t, 26.1, 26.6), ramp(t, 26.3, 28.5));
            P.beads(sh, 640, 1000, 10, 78, ramp(t, 26.15, 26.7), ramp(t, 26.5, 29.0));
          }
        }
        EYE_Y.forEach((y, i) => {
          const k = i + (side < 0 ? 0 : 5);
          const st = eyesState(t, k, k + 1);
          P.eye(sh, ex, y, EYE_W, st);
          if (st.shut) {
            sh.layer({ col: 'rgba(5,1,1,0.9)', hgt: 40 }, (c) => { c.beginPath(); c.arc(ex, y + 4, 9, 0, 7); c.fill(); });
            P.beads(sh, ex, y + 6, 11, 90 + k, ramp(t, st.n + 0.02, st.n + 0.42), ramp(t, st.n + 0.3, st.n + 3.5) * 0.9);
          }
        });
      }
    });
  }

  /* ============================== 6 · plate V, the drowned city ============================== */
  const CITY_TENDRILS = (() => {
    // spread coordinates: left page x 0-1280, right page 1280-2560; the ends stay clear of the rule and couplet
    const R = [
      [[300, 1120], [200, 1250], [60, 1400], [-40, 1500]],
      [[520, 1050], [600, 800], [300, 400], [380, 140]],
      [[760, 1180], [1000, 1350], [1700, 1520], [2420, 1720]],
      [[940, 1080], [1150, 1200], [1350, 1600], [1450, 1740]],
      [[420, 1300], [250, 1300], [60, 1100], [30, 880]],
      [[860, 1350], [1100, 1500], [1500, 1700], [1640, 1800]],
      [[640, 1420], [600, 1600], [760, 1700], [700, 1790]],
      [[980, 1250], [1150, 1000], [1150, 500], [1230, 250]]
    ];
    const rnd = mulberry32(61);
    return R.map((r) => ({ s: r[0], c1: r[1], c2: r[2], e: r[3], ph: rnd() * 6, w: 13 + rnd() * 9, delay: rnd() * 1.2 }));
  })();
  function cityTendrils(sh, t, offsetX) {
    sh.layer(MAT.ink, (c) => {
      c.save(); c.translate(-offsetX, 0);
      CITY_TENDRILS.forEach((T, i) => {
        const pts = P.bez(T.s, T.c1, T.c2, T.e, 80).map((p, j) => {
          const u = j / 80; const amp = 30 * Math.sin(u * Math.PI) + 10 * u;
          return [p[0] + Math.sin(u * 9 - t * 2.4 + T.ph) * amp, p[1] + Math.cos(u * 7 - t * 1.9 + T.ph) * amp * 0.6];
        });
        const grow = 0.35 + 0.65 * E.out2(ramp(t, 32.0 + T.delay, 38.5 + T.delay));
        P.tube(c, pts, (u) => T.w * (1 - u * 0.8) + 1.5, grow, { clw: 2.8, rings: 5, suckers: 4, step: 1, hlw: 1.8 });
      });
      c.restore();
    });
  }
  function cityStatic(sh) {
    P.frameRect(sh, 110, 230, 980, 1360);
    const box = [126, 246, 1074, 1574];
    const rnd = mulberry32(71);
    sh.layer(MAT.inkSoft, (c) => {
      P.hatch(c, (x) => x.rect(126, 246, 948, 560), 0, 17, 1.0, box);
      // the sea: wavy lines, tighter toward the front
      c.save(); c.beginPath(); c.rect(126, 800, 948, 774); c.clip();
      c.lineWidth = 1.4;
      for (let y = 806, i = 0; y < 1580; y += 5 + (1580 - y) * 0.012, i++) {
        c.beginPath();
        for (let x = 126; x <= 1074; x += 8) { const yy = y + Math.sin(x * 0.03 + i * 1.7) * (2 + (y - 800) * 0.008) + Math.sin(x * 0.011 + i) * 3; if (x === 126) c.moveTo(x, yy); else c.lineTo(x, yy); }
        c.stroke();
      }
      c.restore();
    });
    // towers: leaning, wrong-angled, windows as unlit slits
    const towers = [[230, 110, 520, -0.12], [360, 90, 430, 0.18], [470, 150, 610, -0.05], [640, 120, 380, 0.22], [770, 100, 520, -0.2], [880, 140, 460, 0.1], [990, 80, 590, -0.28]];
    towers.forEach(([x, w, top, lean]) => {
      const base = 880 + rnd() * 60;
      const tl = [x - w / 2 + lean * (base - top), top]; const tr = [x + w / 2 + lean * (base - top) + (rnd() - 0.5) * 30, top + (rnd() - 0.5) * 60];
      const bl = [x - w / 2, base]; const br = [x + w / 2, base];
      const quad = (c) => { c.moveTo(tl[0], tl[1]); c.lineTo(tr[0], tr[1]); c.lineTo(br[0], br[1]); c.lineTo(bl[0], bl[1]); c.closePath(); };
      sh.layer({ col: '#0d0a08' }, (c) => { c.beginPath(); quad(c); c.fill(); });
      sh.layer(MAT.ink, (c) => {
        P.hatch(c, quad, Math.PI / 2 + lean, 6, 1.3, [x - w * 2, top - 80, x + w * 2, base + 20]);
        c.lineWidth = 3; c.beginPath(); quad(c); c.stroke();
        // a wrong cap: a wedge that does not sit square
        c.beginPath(); c.moveTo(tl[0], tl[1]); c.lineTo(lerp(tl[0], tr[0], 0.3 + rnd() * 0.5), top - 60 - rnd() * 80); c.lineTo(tr[0], tr[1]); c.stroke();
        c.fillStyle = '#0d0a08';
        for (let j = 0; j < 7; j++) { const yy = lerp(top + 40, base - 40, j / 7); const xx = lerp(tl[0], bl[0], (yy - top) / (base - top)) + w * 0.3; c.fillRect(xx, yy, 10, 26); c.fillRect(xx + w * 0.3, yy + 8, 10, 26); }
      });
    });
  }
  function cityPage() {
    return page(61, cityStatic, { key: (t) => Math.floor(t * 30), paint: (sh, t) => cityTendrils(sh, t, 0) });
  }
  function ruleAeonsPage() {
    return page(62, null, {
      key: (t) => Math.floor(t * 30),
      paint: (sh, t) => {
        cityTendrils(sh, t, 1280);
        P.rule(sh, ['They run'], 690, 470, 150, { a: [ink(t, 33.0)] });
        P.rule(sh, ['after ⌘Q.'], 690, 650, 150, { a: [ink(t, 33.0)], versal: false, cmd: true });
        P.ital(sh, 'That is not dead which can eternal lie,', 690, 900, 54, ink(t, 34.5));
        P.ital(sh, 'And with strange aeons even death may die.', 690, 980, 54, ink(t, 36.5));
        P.caps(sh, 'H. P. LOVECRAFT · THE NAMELESS CITY · 1921', 690, 1070, 30, ink(t, 36.5));
        P.seal(sh, 690, 1340, 125, 33, ramp(t, 38.0, 38.45), E.out3(ramp(t, 38.4, 38.55)), P.SIGILS.cmd);
      }
    });
  }

  /* ============================== 7 · the Elder Sign ============================== */
  const SIGN = { x: 680, y: 880, h: 560, ring: 452 };
  const POSTER = 'NO ACCOUNT · NO TELEMETRY · HANDS OFF YOUR CONFIG · AGENTS RUN AFTER ⌘Q · ';
  function ringText(sh, s, cx, cy, r, size) {
    sh.layer(MAT.ink, (c) => {
      c.font = '600 ' + size + 'px ' + P.BOD; c.textAlign = 'center'; c.textBaseline = 'middle';
      const chars = Array.from(s);
      const ws = chars.map((ch) => (ch === '⌘' ? size * 0.9 : c.measureText(ch).width) + size * 0.16);
      const total = ws.reduce((a, b) => a + b, 0);
      const scale = (2 * Math.PI * r) / total;
      let a = -Math.PI / 2;
      chars.forEach((ch, i) => {
        const aw = (ws[i] * scale) / r; const am = a + aw / 2;
        c.save(); c.translate(cx + Math.cos(am) * r, cy + Math.sin(am) * r); c.rotate(am + Math.PI / 2);
        if (ch === '⌘') P.cmdGlyph(c, 0, 0, size * 0.36, size * 0.075); else c.fillText(ch, 0, 0);
        c.restore();
        a += aw;
      });
      c.lineWidth = 1.6; c.beginPath(); c.arc(cx, cy, r + size * 0.85, 0, 7); c.stroke(); c.beginPath(); c.arc(cx, cy, r - size * 0.85, 0, 7); c.stroke();
      c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, r + size * 1.05, 0, 7); c.stroke();
    });
  }
  function signStatic(sh) { ringText(sh, POSTER, SIGN.x, SIGN.y, SIGN.ring, 44); }
  /** The press at 40.5: the mark fills with blood in 0.3 s; then it darkens and the edges scorch until 44. */
  function paintSign(sh, t) {
    const k = E.out3(ramp(t, 40.5, 40.8));
    if (k <= 0) return;
    const heat = ramp(t, 41.5, 44.0);
    const col = 'rgb(' + Math.round(lerp(122, 70, heat)) + ',' + Math.round(lerp(0, 4, heat)) + ',0)';
    // the impression: a darker rim pressed into the vellum, then the wet mark inside
    sh.layer({ col: 'rgba(0,0,0,0.7)', hgt: 70, alpha: k, blurC: 6 }, (c) => P.withOrbit(c, SIGN.x + 6, SIGN.y + 6, SIGN.h * 1.02, (x, p) => x.fill(p, 'evenodd')));
    sh.layer({ col, hgt: 240, rgh: Math.round(lerp(18, 60, heat)), alpha: k, blurH: 5 }, (c) => P.withOrbit(c, SIGN.x, SIGN.y, SIGN.h * (0.96 + 0.04 * k), (x, p) => x.fill(p, 'evenodd')));
    sh.layer({ col: BLOODHI, hgt: 252, rgh: 12, alpha: k * (1 - heat) * 0.6, blurC: 4 }, (c) => P.withOrbit(c, SIGN.x - 4, SIGN.y - 6, SIGN.h * 0.9, (x, p) => x.fill(p, 'evenodd')));
    if (heat > 0) {
      sh.layer({ col: 'rgba(20,8,2,' + (0.8 * heat).toFixed(3) + ')', blurC: 18 * heat, hgt: 110 }, (c) => P.withOrbit(c, SIGN.x, SIGN.y, SIGN.h * (1.0 + 0.08 * heat), (x, p, sc) => { x.lineWidth = (30 * heat) / sc; x.stroke(p); }));
    }
    P.beads(sh, SIGN.x + 120, SIGN.y + 300, 14, 101, ramp(t, 40.7, 41.2), ramp(t, 41.0, 43.5));
  }
  const BLOODHI = '#b01010';
  /** The burn front in field units: the mark burns through first (44.0-44.45), then the front runs out. */
  const burnR = (t) => (t < 44 ? -1 : t < 44.45 ? 14 * E.out2(ramp(t, 44, 44.45)) : 14 + 88 * E.io2(ramp(t, 44.45, 47.6)));
  /** burn: optional { B: burnField(), ember: canvas } — the sign scene passes it, the turning leaf does not. */
  function signPage(burn) {
    return page(71, signStatic, {
      key: (t) => (t < 40.5 ? 'a' : q(ramp(t, 40.5, 40.8), 10) + ',' + q(ramp(t, 41.5, 44), 40) + ',' + q(ramp(t, 40.7, 43.5), 30) + ',' + (burn ? Math.round(burnR(t) * 4) : 0)),
      paint: (sh, t) => {
        paintSign(sh, t);
        if (burn && burnR(t) >= 0) burnPaint(sh, burn.B, burnR(t), burn.ember);
      }
    });
  }
  function colophonPage() {
    return page(72, (sh) => {
      P.ital(sh, 'One person,', 600, 820, 104, 1);
      P.ital(sh, 'many threads.', 600, 950, 104, 1);
      sh.layer(MAT.inkSoft, (c) => { c.lineWidth = 2; c.beginPath(); c.moveTo(500, 1040); c.lineTo(700, 1040); c.stroke(); });
    }, null);
  }

  /* ---- The burn: a field over the sign page, lowest inside the mark, rising outward with noise ---- */
  function burnField() {
    const w = 320; const h = Math.round(w * PH / PW); const s = w / PW;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff';
    P.withOrbit(x, SIGN.x * s, SIGN.y * s, SIGN.h * s, (c, p) => c.fill(p, 'evenodd'));
    const m = x.getImageData(0, 0, w, h).data;
    const INF = 1e9; const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = m[i * 4] > 127 ? 0 : INF;
    // two-pass chamfer distance (in sheet pixels at this scale)
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const i = y * w + xx; let v = d[i];
      if (xx > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) v = Math.min(v, d[i - w] + 1);
      if (xx > 0 && y > 0) v = Math.min(v, d[i - w - 1] + 1.414); if (xx < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + 1.414);
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let xx = w - 1; xx >= 0; xx--) {
      const i = y * w + xx; let v = d[i];
      if (xx < w - 1) v = Math.min(v, d[i + 1] + 1); if (y < h - 1) v = Math.min(v, d[i + w] + 1);
      if (xx < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + 1.414); if (xx > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + 1.414);
      d[i] = v;
    }
    const h2 = (a, b) => F.hash(a * 127.1 + b * 311.7);
    const vn = (x0, y0) => { const ix = Math.floor(x0); const iy = Math.floor(y0); const fx = x0 - ix; const fy = y0 - iy; const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy); return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), sx), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), sx), sy); };
    const f = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const i = y * w + xx;
      const n = vn(xx * 0.05, y * 0.05) * 0.55 + vn(xx * 0.13 + 9, y * 0.13) * 0.3 + vn(xx * 0.4, y * 0.4 + 3) * 0.15;
      f[i] = (d[i] === 0 ? n * 10 : d[i] + 6) * (1 + 0.7 * (n - 0.5)) + n * 8;
    }
    return { w, h, f };
  }
  /** Burns the sign page: r (field units) is the front. Holes become alpha 0, a char band, an ember line. */
  function burnPaint(sh, B, r, ember) {
    const { w, h, f } = B;
    const hole = new ImageData(w, h); const char = new ImageData(w, h); const em = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = f[i] - r; const j = i * 4;
      if (v < 0) { hole.data[j + 3] = 255; continue; }
      if (v < 16) { const a = 1 - v / 16; char.data[j] = 10; char.data[j + 1] = 5; char.data[j + 2] = 3; char.data[j + 3] = Math.round(255 * Math.min(1, a * a * 1.8)); }
      if (v < 1.2) { const a = 1 - v / 1.2; em.data[j] = 255; em.data[j + 1] = 70 + Math.round(90 * a); em.data[j + 2] = 12; em.data[j + 3] = Math.round(255 * a); }
    }
    const put = (img) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(img, 0, 0); return cv; };
    const ch = put(char); const ho = put(hole); const emc = put(em);
    const draw = (ctx, cv, op, blur) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = op; ctx.imageSmoothingEnabled = true; if (blur) ctx.filter = 'blur(' + blur + 'px)'; ctx.drawImage(cv, 0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore(); };
    draw(sh.c, ch, 'source-over', 2);
    draw(sh.c, emc, 'source-over', 1.2);
    draw(sh.c, ho, 'destination-out', 0.6);
    draw(sh.hx, ch, 'source-over', 2);
    if (ember) { const e = ember.getContext('2d'); e.save(); e.setTransform(1, 0, 0, 1, 0, 0); e.fillStyle = '#000'; e.fillRect(0, 0, ember.width, ember.height); e.restore(); draw(e, emc, 'source-over', 0.6); }
  }

  window.Film = {
    TOPS, wx, wz, burnR, EYE1, PUPIL3, EYE_Y, EYE_W, NAIL_T, SIGN, turn, ink, q,
    boards, coverSheet, treePage, ruleBranchPage, casketPage, ruleConfigPage, eyePlatePage, ruleAccountPage,
    eyesPage, cityPage, ruleAeonsPage, signPage, colophonPage, burnField, burnPaint, page, cache, restore, flood
  };
})();
