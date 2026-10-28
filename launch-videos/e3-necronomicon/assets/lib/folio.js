/* Film E3's one material: a real book on a stone table, lit by one raking candle, rendered with Three.js.
   Every scene builds its own copy of the book with the pages it shows, then draws the frame for film time t through
   render(t, state). Nothing here keeps a clock: the camera, the light flicker and every page are functions of t, so
   seeking any frame gives the same picture.
   Units: a page is W = 1 wide (x, from the spine) and H = 1.42 tall (z, the far edge is -z); the table is y = 0. */
(function () {
  const W = 1;
  const H = 1.42;
  const BOARD = 0.022;
  const TEX_W = 1280;
  const TEX_H = Math.round(TEX_W * H / W);

  /* ---- Pure helpers: everything is a function of t ---- */
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ramp = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    in2: (k) => k * k,
    in3: (k) => k * k * k,
    in4: (k) => k * k * k * k,
    out2: (k) => 1 - (1 - k) * (1 - k),
    out3: (k) => 1 - Math.pow(1 - k, 3),
    out4: (k) => 1 - Math.pow(1 - k, 4),
    expo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
    io2: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
    io3: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    back: (k) => { const c1 = 1.4; const c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }
  };
  const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const n1 = (x) => { const i = Math.floor(x); const f = x - i; const s = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), s); };

  /** Calls fn(t) for every time the timeline is seeked to, through a setter GSAP writes (callbacks may be suppressed). */
  function drive(tl, dur, fn) {
    const clock = { _t: 0 };
    Object.defineProperty(clock, 't', { get() { return this._t; }, set(x) { this._t = x; fn(x); } });
    tl.fromTo(clock, { t: 0 }, { t: dur, duration: dur, ease: 'none', immediateRender: true }, 0);
    fn(0);
    return clock;
  }

  /* ---- The camera for the whole film, keyed in film seconds, so every seam matches by construction ----
     A key: [filmT, tx, tz, dist, pitch(deg), yaw(deg), ty, ease into this key]. Target y follows the page surface. */
  const CAM = [];
  function camKeys(keys) { CAM.length = 0; keys.forEach((k) => CAM.push(k)); }
  function camAt(t) {
    if (!CAM.length) return { tx: 0.5, tz: 0, d: 2.6, p: 90, y: 0 };
    let i = 0;
    while (i < CAM.length - 1 && CAM[i + 1][0] <= t) i++;
    const a = CAM[i];
    const b = CAM[Math.min(i + 1, CAM.length - 1)];
    let k = b[0] > a[0] ? clamp01((t - a[0]) / (b[0] - a[0])) : 1;
    if (t < a[0]) k = 0;
    const ease = E[b[7] || 'io2'] || E.io2;
    const kk = ease(k);
    // Distance moves in log space so a dive keeps its speed all the way in.
    return {
      tx: lerp(a[1], b[1], kk), tz: lerp(a[2], b[2], kk),
      d: Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), kk)),
      p: lerp(a[4], b[4], kk), y: lerp(a[5], b[5], kk), ty: lerp(a[6] || 0.06, b[6] || 0.06, kk)
    };
  }

  /* ---- Page sheets: an albedo canvas, a height canvas (bump) and a roughness canvas, painted together ---- */
  let VELLUM = null;
  function vellumSource() {
    if (VELLUM) return VELLUM;
    const w = 640; const h = Math.round(w * H / W);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    const img = x.createImageData(w, h);
    const rnd = mulberry32(17);
    const G = 64; const grid = new Float32Array((G + 1) * (G + 1) * 3);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const vn = (u, v, o) => {
      const fx = u * G; const fy = v * G; const ix = Math.floor(fx) % G; const iy = Math.floor(fy) % G;
      const ax = fx - Math.floor(fx); const ay = fy - Math.floor(fy);
      const sx = ax * ax * (3 - 2 * ax); const sy = ay * ay * (3 - 2 * ay);
      const g = (a, b) => grid[(((b % G) * (G + 1)) + (a % G)) * 3 + o];
      return lerp(lerp(g(ix, iy), g(ix + 1, iy), sx), lerp(g(ix, iy + 1), g(ix + 1, iy + 1), sx), sy);
    };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const u = i / w; const v = j / h;
        const m = vn(u * 0.11, v * 0.08, 0) * 0.5 + vn(u * 0.37, v * 0.31, 1) * 0.3 + vn(u * 1.3, v * 1.1, 2) * 0.2;
        const fib = hash(j * 0.71 + Math.floor(i / 3) * 13.1) * 0.5 + hash(j * 1.3 + i * 0.07) * 0.5;
        const k = (j * w + i) * 4;
        const lum = m * 0.85 + fib * 0.15;
        img.data[k] = lum * 255; img.data[k + 1] = fib * 255; img.data[k + 2] = vn(u * 2.7, v * 2.9, 0) * 255; img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    VELLUM = cv;
    return cv;
  }

  /** A page-sized set of canvases. Draw calls go through layer(): one shape, three materials. */
  function Sheet(opts) {
    const o = opts || {};
    this.w = o.w || TEX_W; this.h = o.h || TEX_H;
    this.aux = o.aux || 0.5;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    this.cc = mk(this.w, this.h);
    this.hc = mk(Math.round(this.w * this.aux), Math.round(this.h * this.aux));
    this.rc = mk(Math.round(this.w * this.aux), Math.round(this.h * this.aux));
    this.c = this.cc.getContext('2d');
    this.hx = this.hc.getContext('2d');
    this.rx = this.rc.getContext('2d');
    this.hx.setTransform(this.aux, 0, 0, this.aux, 0, 0);
    this.rx.setTransform(this.aux, 0, 0, this.aux, 0, 0);
    this.map = new THREE.CanvasTexture(this.cc);
    this.map.colorSpace = THREE.SRGBColorSpace;
    this.map.anisotropy = 8;
    this.bump = new THREE.CanvasTexture(this.hc);
    this.rough = new THREE.CanvasTexture(this.rc);
    this.key = null;
  }
  Sheet.prototype.ctxs = function () { return [this.c, this.hx, this.rx]; };
  /** Paints the vellum ground: black-brown mottling, fibre, a darker edge. */
  Sheet.prototype.vellum = function (seed, tone) {
    const src = vellumSource();
    const { c, hx, rx, w, h } = this;
    const flip = seed % 2 ? -1 : 1;
    const tn = tone || [13, 10, 8];
    c.save();
    c.fillStyle = 'rgb(' + tn[0] + ',' + tn[1] + ',' + tn[2] + ')';
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 0.55;
    c.globalCompositeOperation = 'lighter';
    c.translate(flip < 0 ? w : 0, 0); c.scale(flip, 1);
    c.filter = 'sepia(1) saturate(0.5) brightness(0.11)';
    c.drawImage(src, 0, 0, w, h);
    c.restore();
    // edge falloff (handled, foxed edges)
    c.save();
    const gx = c.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0.35)'); gx.addColorStop(0.06, 'rgba(0,0,0,0)'); gx.addColorStop(0.94, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = gx; c.fillRect(0, 0, w, h);
    const gy = c.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0.3)'); gy.addColorStop(0.05, 'rgba(0,0,0,0)'); gy.addColorStop(0.95, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = gy; c.fillRect(0, 0, w, h);
    c.restore();
    hx.save(); hx.setTransform(1, 0, 0, 1, 0, 0);
    hx.fillStyle = 'rgb(120,120,120)'; hx.fillRect(0, 0, this.hc.width, this.hc.height);
    hx.globalAlpha = 0.35; hx.filter = 'grayscale(1) contrast(1.4)';
    hx.drawImage(src, 0, 0, this.hc.width, this.hc.height);
    hx.restore();
    rx.save(); rx.setTransform(1, 0, 0, 1, 0, 0);
    rx.fillStyle = 'rgb(205,205,205)'; rx.fillRect(0, 0, this.rc.width, this.rc.height);
    rx.restore();
  };
  /** Runs draw(ctx) once per layer with that layer's fill and stroke set. m: { col, hgt (0-255), rgh (0-255), blurH } */
  Sheet.prototype.layer = function (m, draw) {
    const L = [[this.c, m.col], [this.hx, m.hgt == null ? null : 'rgb(' + m.hgt + ',' + m.hgt + ',' + m.hgt + ')'], [this.rx, m.rgh == null ? null : 'rgb(' + m.rgh + ',' + m.rgh + ',' + m.rgh + ')']];
    L.forEach(([x, col], i) => {
      if (!col) return;
      x.save();
      x.fillStyle = col; x.strokeStyle = col;
      if (m.alpha != null) x.globalAlpha = m.alpha;
      if (m.op && i === 0) x.globalCompositeOperation = m.op;
      if (m.hop && i === 1) x.globalCompositeOperation = m.hop;
      const blur = i === 0 ? m.blurC : i === 1 ? m.blurH : m.blurR;
      if (blur) x.filter = 'blur(' + blur + 'px)';
      draw(x, i);
      x.restore();
    });
  };
  Sheet.prototype.commit = function () { this.map.needsUpdate = true; this.bump.needsUpdate = true; this.rough.needsUpdate = true; };
  /** Repaints only when key changes; paint(sheet) draws the whole page. */
  Sheet.prototype.update = function (key, paint) {
    if (key === this.key) return;
    this.key = key;
    paint(this);
    this.commit();
  };

  /* ---- Materials ---- */
  const INK = '#d6c8aa';
  const MAT = {
    ink: { col: INK, hgt: 165, rgh: 140 },
    inkSoft: { col: '#a99c82', hgt: 150, rgh: 150 },
    blood: { col: '#8e0505', hgt: 235, rgh: 22, blurH: 7 },
    bloodDeep: { col: '#5e0000', hgt: 250, rgh: 18, blurH: 7 },
    bloodLit: { col: '#d10f0f', hgt: 240, rgh: 20 },
    hole: { col: '#050302', hgt: 60, rgh: 230 }
  };

  /* ---- Geometry ---- */
  /** The page surface bows: it dips into the gutter and rises a little over the page. */
  const bow = (s) => -0.03 * Math.exp(-s / 0.07) + 0.008 * Math.sin(Math.PI * Math.min(1, s / W));
  const bowSlope = (s) => (0.03 / 0.07) * Math.exp(-s / 0.07) + 0.008 * Math.PI / W * Math.cos(Math.PI * Math.min(1, s / W));

  function gridGeometry(nu, nv) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
    const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
    const idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i;
      uv[k * 2] = i / nu; uv[k * 2 + 1] = 1 - j / nv;
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i; const b = a + 1; const c = a + nu + 1; const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.userData = { nu, nv };
    return g;
  }

  /** Lays a grid along the curve of a leaf. theta 0 = flat on the right, PI = flat on the left. */
  function shapeLeaf(g, o) {
    const { nu, nv } = g.userData;
    const pos = g.attributes.position.array;
    const theta = o.theta;
    const lag = o.lag == null ? 0.6 : o.lag;
    const lift = o.y0;
    const w = o.w || W; const h = o.h || H;
    const steps = nu;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv; // 0 far edge, 1 near edge
      const corner = (o.corner || 0) * (v - 0.5);
      let x = 0; let y = lift + (o.rigid ? 0 : bow(0)); const ds = w / steps;
      for (let i = 0; i <= nu; i++) {
        const k = (j * (nu + 1) + i) * 3;
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = -h / 2 + v * h;
        const s = (i + 0.5) * ds;
        const u = s / w;
        const flatBow = o.rigid ? 0 : Math.atan(bowSlope(s)) * Math.cos(theta);
        const phi = theta + flatBow - (lag * Math.sin(theta) * Math.pow(u, 1.4)) * (1 + corner);
        x += Math.cos(phi) * ds; y += Math.sin(phi) * ds;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }

  function flatPage(side, y0, nu, flat) {
    const g = gridGeometry(nu || 48, 2);
    const { nv } = g.userData;
    const pos = g.attributes.position.array;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= g.userData.nu; i++) {
      const k = (j * (g.userData.nu + 1) + i) * 3;
      const s = i / g.userData.nu * W;
      pos[k] = side > 0 ? s : -W + s;
      pos[k + 1] = y0 + (flat ? 0 : bow(side > 0 ? s : W - s));
      pos[k + 2] = -H / 2 + j / nv * H;
    }
    g.computeVertexNormals();
    return g;
  }

  /* ---- The book ---- */
  function Book(canvas, opts) {
    const o = opts || {};
    this.canvas = canvas;
    canvas.width = 1920; canvas.height = 1080;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: !!o.alpha, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.setSize(1920, 1080, false);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    if (o.alpha) r.setClearColor(0x000000, 0);
    this.r = r;
    const sc = new THREE.Scene();
    if (!o.alpha) sc.background = new THREE.Color('#030202');
    this.scene = sc;
    this.cam = new THREE.PerspectiveCamera(30, 1920 / 1080, 0.01, 40);

    // One candle, low from the upper left; a faint warm fill so the shadows are not holes.
    const key = new THREE.SpotLight(0xffb070, 60, 0, 0.62, 0.85, 1.2);
    key.position.set(-2.3, 0.95, -1.35);
    key.target.position.set(0.25, 0, 0.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 8;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 3;
    sc.add(key); sc.add(key.target);
    this.key = key;
    const fill = new THREE.HemisphereLight(0x3a2a24, 0x050302, 0.18);
    sc.add(fill);
    this.fill = fill;
    // What wet things reflect: a dim warm ceiling and the candle itself (a small hot patch in the key's direction).
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#020101');
    const glow = (col, w, h, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
    };
    glow(new THREE.Color(5.0, 3.0, 1.6), 0.9, 0.7, -2.3, 0.95, -1.35);
    glow(new THREE.Color(0.22, 0.14, 0.09), 6, 6, 0.6, 3.2, 1.2);
    glow(new THREE.Color(0.5, 0.3, 0.18), 1.6, 0.5, 1.8, 1.4, 1.6);
    const pm = new THREE.PMREMGenerator(r);
    sc.environment = pm.fromScene(envScene, 0.02).texture;

    // Stone table.
    const tcv = document.createElement('canvas'); tcv.width = 512; tcv.height = 512;
    const tx = tcv.getContext('2d');
    tx.fillStyle = '#0e0c0b'; tx.fillRect(0, 0, 512, 512);
    tx.globalAlpha = 0.5; tx.filter = 'grayscale(1) brightness(0.25)';
    tx.drawImage(vellumSource(), 0, 0, 512, 512);
    const ttex = new THREE.CanvasTexture(tcv); ttex.colorSpace = THREE.SRGBColorSpace; ttex.wrapS = ttex.wrapT = THREE.RepeatWrapping; ttex.repeat.set(4, 4);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ map: ttex, roughness: 0.92, bumpMap: ttex, bumpScale: 1.5 }));
    table.rotation.x = -Math.PI / 2; table.receiveShadow = true;
    sc.add(table);
    this.table = table;

    this.flesh = o.flesh || null; // a Sheet painted as flesh, for the boards
    this.leftTop = o.leftTop == null ? 0.05 : o.leftTop;
    this.rightTop = o.rightTop == null ? 0.07 : o.rightTop;
    this.group = new THREE.Group();
    sc.add(this.group);
    this._build(o);
  }

  function pageMaterial(sheet, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({
      map: sheet ? sheet.map : null, bumpMap: sheet ? sheet.bump : null, bumpScale: 1.6,
      roughnessMap: sheet ? sheet.rough : null, roughness: 1, metalness: 0, envMapIntensity: 0.6
    }, extra || {}));
  }

  /** The block of leaves under a page: its edges are striped like the edge of a book. */
  function edgeTexture() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
    const x = cv.getContext('2d');
    for (let j = 0; j < 256; j++) {
      const v = 30 + hash(j * 3.1) * 26 + (j % 7 === 0 ? -14 : 0);
      x.fillStyle = 'rgb(' + (v + 6) + ',' + (v - 2) + ',' + (v - 8) + ')';
      x.fillRect(0, j, 64, 1);
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  Book.prototype._build = function (o) {
    const g = this.group;
    const fleshMat = this.flesh ? pageMaterial(this.flesh, { bumpScale: 5, roughness: 1, envMapIntensity: 0.5 }) : new THREE.MeshStandardMaterial({ color: '#2a1410', roughness: 0.5 });
    this.fleshMat = fleshMat;
    const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.9 });
    const add = (m) => { m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    // Boards (the open book lies on its boards; the closed book only has the back board on the right).
    this.boards = [];
    if (o.leftBoard !== false) {
      const lb = add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.05, BOARD, H + 0.07), fleshMat));
      lb.position.set(-(W + 0.05) / 2 - 0.005, BOARD / 2, 0);
      this.boards.push(lb);
    }
    const rb = add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.05, BOARD, H + 0.07), fleshMat));
    rb.position.set((W + 0.05) / 2 + 0.005, BOARD / 2, 0);
    this.boards.push(rb);
    // Page blocks.
    const blk = (side, top) => {
      const th = Math.max(0.004, top - BOARD - 0.004);
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(W - 0.01, th, H - 0.01), edgeMat));
      m.position.set(side * (W / 2 + 0.006), BOARD + th / 2, 0);
      return m;
    };
    if (o.leftBoard !== false && this.leftTop > BOARD + 0.006) this.leftBlock = blk(-1, this.leftTop - 0.012);
    this.rightBlock = blk(1, this.rightTop - 0.012);
    // Static pages.
    this.leftPage = add(new THREE.Mesh(o.flatLeft ? flatPage(-1, this.leftTop, 8, true) : flatPage(-1, this.leftTop), pageMaterial(null)));
    this.rightPage = add(new THREE.Mesh(flatPage(1, this.rightTop), pageMaterial(null)));
    this.leftPage.visible = o.leftBoard !== false;
    // The turning leaf: recto and verso share one bending grid.
    const lg = gridGeometry(56, 10);
    this.leafGeo = lg;
    this.recto = new THREE.Mesh(lg, pageMaterial(null, { side: THREE.FrontSide, shadowSide: THREE.DoubleSide }));
    this.verso = new THREE.Mesh(lg, pageMaterial(null, { side: THREE.BackSide }));
    this.recto.castShadow = true; this.recto.receiveShadow = true; this.verso.receiveShadow = true;
    g.add(this.recto); g.add(this.verso);
    this.recto.visible = this.verso.visible = false;
  };

  const setMap = (mesh, sheet, flip) => {
    const m = mesh.material;
    if (!sheet) { mesh.visible = false; return; }
    mesh.visible = true;
    const tex = flip ? sheet.flipped || (sheet.flipped = flipTex(sheet)) : { map: sheet.map, bump: sheet.bump, rough: sheet.rough };
    if (m.map !== tex.map) {
      m.map = tex.map; m.bumpMap = tex.bump; m.roughnessMap = tex.rough; m.needsUpdate = true;
    }
  };
  function flipTex(sheet) {
    const f = (t) => { const c = t.clone(); c.repeat.x = -1; c.offset.x = 1; c.wrapS = THREE.RepeatWrapping; c.needsUpdate = true; return c; };
    // Clones share the canvas image; they need their own needsUpdate when the sheet repaints.
    const out = { map: f(sheet.map), bump: f(sheet.bump), rough: f(sheet.rough) };
    out.map.colorSpace = THREE.SRGBColorSpace;
    const commit = sheet.commit.bind(sheet);
    sheet.commit = function () { commit(); out.map.needsUpdate = true; out.bump.needsUpdate = true; out.rough.needsUpdate = true; };
    return out;
  }

  /** The front board: flesh outside, the first plate pasted inside. It turns rigidly about the spine. */
  Book.prototype.addCover = function (front, back, closedTop) {
    const CW = W + 0.05; const CH = H + 0.07; const x0 = 0.005;
    const pivot = new THREE.Group();
    const top = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), pageMaterial(front, { bumpScale: 7, envMapIntensity: 0.55 }));
    top.rotation.x = -Math.PI / 2; top.position.set(x0 + CW / 2, BOARD, 0);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(CW - 0.004, BOARD * 0.9, CH - 0.004), this.fleshMat);
    edge.position.set(x0 + CW / 2, BOARD * 0.5, 0);
    // the pastedown: a page facing down, mirrored so it reads as a left page once the board lies open
    const g = gridGeometry(8, 2);
    const pos = g.attributes.position.array;
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= 8; i++) {
      const k = (j * 9 + i) * 3;
      pos[k] = W - (i / 8) * W; pos[k + 1] = -0.004; pos[k + 2] = -H / 2 + (j / 2) * H;
    }
    g.computeVertexNormals();
    const paste = new THREE.Mesh(g, pageMaterial(back, { side: THREE.FrontSide }));
    [top, edge, paste].forEach((m) => { m.castShadow = true; m.receiveShadow = true; pivot.add(m); });
    this.group.add(pivot);
    this.coverPivot = pivot;
    this.coverClosedTop = closedTop;
  };
  /** theta 0 = closed on the right block, PI = open, lying on the table on the left. */
  Book.prototype.coverPose = function (theta) {
    const k = clamp01((theta / Math.PI - 0.5) * 2);
    const yp = lerp(this.coverClosedTop + 0.004, BOARD, k * k * (3 - 2 * k));
    this.coverPivot.position.set(0, yp, 0);
    this.coverPivot.rotation.set(0, 0, theta);
  };

  /** Shows a spread: { left, right } sheets on the static pages, and an optional turning leaf { recto, verso, theta }. */
  Book.prototype.pages = function (s) {
    setMap(this.leftPage, s.left);
    setMap(this.rightPage, s.right);
    if (s.leaf) {
      const L = s.leaf;
      // The leaf leaves the right block's height and lands at the left block's, 2 mm proud of both.
      const y0 = lerp(this.rightTop, this.leftTop, E.io2(clamp01(L.theta / Math.PI))) + 0.002;
      shapeLeaf(this.leafGeo, { theta: L.theta, lag: L.lag, corner: L.corner == null ? 0.25 : L.corner, y0, rigid: L.rigid });
      setMap(this.recto, L.recto);
      setMap(this.verso, L.verso, true);
    } else {
      this.recto.visible = this.verso.visible = false;
    }
  };

  /** A point and normal on the turning leaf: u along the leaf from the spine, vv 0 far edge → 1 near edge. */
  Book.prototype.leafPoint = function (u, vv) {
    const g = this.leafGeo; const { nu, nv } = g.userData;
    const P = g.attributes.position.array; const N = g.attributes.normal.array;
    const fi = u * nu; const fj = vv * nv; const i = Math.min(nu - 1, Math.floor(fi)); const j = Math.min(nv - 1, Math.floor(fj));
    const a = fi - i; const b = fj - j;
    const at = (arr, ii, jj, c) => arr[(jj * (nu + 1) + ii) * 3 + c];
    const bil = (arr, c) => lerp(lerp(at(arr, i, j, c), at(arr, i + 1, j, c), a), lerp(at(arr, i, j + 1, c), at(arr, i + 1, j + 1, c), a), b);
    return { p: new THREE.Vector3(bil(P, 0), bil(P, 1), bil(P, 2)), n: new THREE.Vector3(bil(N, 0), bil(N, 1), bil(N, 2)).normalize() };
  };

  /** Ten forged nails (a square tapered shank, a hammered head, dark iron), hidden until placed. */
  Book.prototype.addNails = function (n) {
    const iron = new THREE.MeshStandardMaterial({ color: '#2e2824', metalness: 0.85, roughness: 0.42, envMapIntensity: 1.4 });
    const out = [];
    for (let k = 0; k < n; k++) {
      const g = new THREE.Group();
      const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0016, 0.05, 4), iron);
      shank.position.y = -0.025; shank.rotation.y = Math.PI / 4;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.009, 7), iron);
      head.position.y = 0.0045; head.rotation.y = k * 0.7;
      [shank, head].forEach((m) => { m.castShadow = true; m.receiveShadow = true; g.add(m); });
      g.visible = false;
      this.group.add(g);
      out.push(g);
    }
    return out;
  };
  /** Places a nail: at a fixed page point dropped from `fall` (0 = high above, 1 = home), or riding the leaf. */
  Book.prototype.placeNail = function (g, o) {
    g.quaternion.setFromEuler(new THREE.Euler(o.tilt, o.spin, o.tilt * 0.6));
    if (o.leaf) {
      const lp = this.leafPoint(o.leaf.u, o.leaf.vv);
      g.position.copy(lp.p);
      g.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), lp.n));
    } else {
      g.position.set(o.p.x, o.p.y + 0.55 * Math.pow(1 - o.fall, 2), o.p.z);
    }
  };
  /** Lets the right page burn through: alpha holes cut by its map, an ember map that glows; the table loses its
      floor under the page so the holes open onto whatever is behind the canvas. Returns the ember texture. */
  Book.prototype.burnable = function (emberCanvas) {
    const emberTex = new THREE.CanvasTexture(emberCanvas);
    const rm = this.rightPage.material;
    rm.alphaTest = 0.5; rm.emissive = new THREE.Color('#ffffff'); rm.emissiveMap = emberTex; rm.emissiveIntensity = 3; rm.needsUpdate = true;
    const acv = document.createElement('canvas'); acv.width = 1400; acv.height = 1000;
    const ax = acv.getContext('2d'); ax.fillStyle = '#fff'; ax.fillRect(0, 0, 1400, 1000);
    ax.fillStyle = '#000'; ax.fillRect((0.004 + 7) / 14 * 1400, (-H / 2 + 0.004 + 5) / 10 * 1000, (W - 0.008) / 14 * 1400, (H - 0.008) / 10 * 1000);
    const am = this.table.material; am.alphaMap = new THREE.CanvasTexture(acv); am.alphaTest = 0.5; am.needsUpdate = true;
    this.emberTex = emberTex;
    return emberTex;
  };
  /** Per frame while burning: the ember map repaints, the edge smoulders (glow 0..1), and the block under the page goes. */
  Book.prototype.burning = function (on, glow) {
    // every state is set from t alone: a seek back to before the fire clears the embers
    if (!on) { const e = this.emberTex.image.getContext('2d'); e.setTransform(1, 0, 0, 1, 0, 0); e.clearRect(0, 0, e.canvas.width, e.canvas.height); }
    this.emberTex.needsUpdate = true;
    this.rightPage.material.emissiveIntensity = on ? 3 * glow : 0;
    this.boards[1].visible = !on; this.rightBlock.visible = !on;
  };

  /** Camera from a camAt() pose plus a small handheld drift; light flicker from film time. */
  Book.prototype.render = function (t, pose, extra) {
    const c = pose || camAt(t);
    const x = extra || {};
    const p = (c.p * Math.PI) / 180; const yw = (c.y * Math.PI) / 180;
    const drift = x.drift == null ? 1 : x.drift;
    const dx = (Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.9 + 1) * 0.4) * 0.0026 * c.d * drift;
    const dz = (Math.sin(t * 0.53 + 2) * 0.6 + Math.sin(t * 1.3) * 0.4) * 0.0026 * c.d * drift;
    const jolt = x.jolt || 0;
    const tx = c.tx + dx + jolt * 0.004 * c.d; const tz = c.tz + dz - jolt * 0.003 * c.d; const ty = c.ty == null ? 0.06 : c.ty;
    this.cam.position.set(tx + Math.sin(yw) * Math.cos(p) * c.d, ty + Math.sin(p) * c.d, tz + Math.cos(yw) * Math.cos(p) * c.d);
    this.cam.up.set(0, 1, 0);
    if (c.p > 89.5) this.cam.up.set(-Math.sin(yw), 0, -Math.cos(yw));
    this.cam.lookAt(tx, ty, tz);
    if (x.roll) this.cam.rotateZ(x.roll);
    this.cam.fov = x.fov || 30;
    this.cam.updateProjectionMatrix();
    // The candle: three incommensurate flickers, sampled at 12 Hz so it gutters rather than shimmers.
    const q = Math.floor(t * 12);
    const fl = 0.93 + 0.05 * (hash(q * 1.7) - 0.5) * 2 + 0.03 * Math.sin(t * 2.3) + 0.02 * Math.sin(t * 5.1 + 1);
    this.key.intensity = 60 * fl * (x.light == null ? 1 : x.light);
    this.r.render(this.scene, this.cam);
  };

  /** Projects a page point (u, v in 0-1 of the right or left page) to screen pixels. */
  Book.prototype.project = function (side, u, v, top) {
    const s = u * W;
    const x = side > 0 ? s : -W + s;
    const y = (top == null ? (side > 0 ? this.rightTop : this.leftTop) : top) + bow(side > 0 ? s : W - s);
    const vec = new THREE.Vector3(x, y, -H / 2 + (1 - v) * H);
    vec.project(this.cam);
    return { x: (vec.x * 0.5 + 0.5) * 1920, y: (0.5 - vec.y * 0.5) * 1080 };
  };

  /** A world point on a page, for placing 3D props (nails). */
  function pagePoint(side, u, v, top) {
    const s = u * W;
    return new THREE.Vector3(side > 0 ? s : -W + s, top + bow(side > 0 ? s : W - s), -H / 2 + (1 - v) * H);
  }

  /** Waits for faces. */
  function fonts(list) { return Promise.all(list.map((f) => document.fonts.load(f))).then(() => document.fonts.ready); }

  window.Folio = {
    W, H, BOARD, TEX_W, TEX_H, INK, MAT, E,
    clamp01, ramp, lerp, hash, n1, mulberry32, drive, camKeys, camAt,
    Sheet, Book, pagePoint, fonts, bow
  };
})();
