/*!
 * papyrus-hero-v2.js — Festivals & Society: page loader + self-drawing hero f.
 * Standalone, no dependencies.  Load it as the FIRST element inside <body>, so the loader
 * covers the page before anything else paints:
 *
 *   <body>
 *     <script src="papyrus-hero-v2.js"></script>
 *     …
 *     <div data-papyrus-slot class="w-32 h-44"></div>      ← the hero's f box: where the f lands
 *
 * Sequence
 *   loading    a rolled papyrus idles on a full-screen cover (#EFEBE0) until the page is ready;
 *   release    it unrolls, turns its right-hand edge toward the viewer and, seen edge-on,
 *              becomes a line; the cover fades and the line shrinks into the slot;
 *   in place   the line bends into the f; the bar is drawn last.  The canvas is then replaced
 *              by an inline SVG of the f inside the slot.
 *   Hooks for the rest of the hero:  <html> gets .papyrus-loading, then .papyrus-revealed (kept)
 *   and finally .papyrus-done; document fires 'papyrus:reveal' and 'papyrus:done'.  Start the
 *   hero's own entrance on .papyrus-revealed, e.g.
 *     .papyrus-revealed .hero-title { animation: fadeUp 1s cubic-bezier(.16,1,.3,1) .35s forwards }
 *   Timing (s after release): unroll 0–1.55, turn 1.25–2.4, shrink into the slot 1.8–2.85,
 *   cover fades 2.1–2.7, f takes shape 2.6–3.6, bar 3.5–4.05.  See SEQ; `speed` scales it.
 *   prefers-reduced-motion (or { skip: true }): no loader; the finished f is placed at once.
 *
 * Options: set window.PAPYRUS_HERO = { … } before the script (see DEFAULTS).
 * API:     window.PapyrusHeroV2.release()  start now (with { release: 'manual' })
 *          window.PapyrusHeroV2.svg()      the finished f as standalone SVG markup
 *
 * Geometry (as in v1): the sheet is a generalised cylinder whose profile is integrated from its
 * curvature κ(s) over arc length, so it never stretches.  Orthographic view, yawed by φ about
 * the vertical axis, right-hand edge forward: X = x·cos φ + u·sin φ, Y = v (u = −z, v = y).
 * Of two surface points on one sight line the one with smaller u is in front, which makes
 * hidden-line removal an exact 1-D test per height.
 *
 * The f of v2 is built from the papyrus itself: both terminals are the innermost turns of the
 * two rolls (one spiral law, constant pitch), joined by a stem whose curvature falls linearly to
 * zero at the middle.  The figure is point-symmetric about the middle of the stem, where the
 * level bar crosses it with equal arms.
 */
(function () {
  'use strict';
  if (window.PapyrusHeroV2) return;

  const DEFAULTS = {
    slot: '[data-papyrus-slot]',
    background: '#EFEBE0',  // ancient-100, the hero section
    ink: '#000000',
    release: 'load',        // 'load' = window load + fonts; 'manual' = PapyrusHeroV2.release()
    minLoader: 0.7,         // s: the loader is shown at least this long
    maxWait: 8,             // s: start anyway after this long
    speed: 1,
    autostart: true,
    skip: false,            // true = no intro, place the finished f at once (as for reduced motion)
    freezeAt: null,         // review aid: hold the sequence at this time (s after release)
    // size
    heroFill: 1.0,          // f height ÷ slot height (slot 176 px → f 176 px; the old f is ~149 px)
    loaderSize: 0.46,       // open papyrus height ÷ viewport height
    loaderMaxScale: 3,      // px per f-unit, cap for very large screens
    lineLoader: 2.0,        // px, while the papyrus is large
    lineHero: 2.6,          // px, the finished f
    // papyrus (f-units: the f is `height` units tall)
    sheetWidth: 120,
    yawStart: 30,           // degrees
    rollInner: 3.6,         // innermost radius of the rolls = of the f's curls
    rollGap: 4.6,           // pitch of the rolls = of the f's curls
    openBend: 0.45,         // share of the stem's bend the sheet has once open
    liftOff: 8,             // length over which the sheet leaves a roll
    extraCurl: 22,          // the open sheet keeps this much more curl than the f
    // the f
    height: 127,
    slant: 7,               // degrees from vertical, at the middle of the stem
    termLen: 54,            // length of each spiral terminal
    termRamp: 30,           // length over which a terminal eases into the stem
    stemBend: 0.008,        // stem curvature where it meets a terminal (→ 0 at the middle)
    barRatio: 0.62,         // half-bar ÷ half-width of the f
    samples: 901,
  };

  // Seconds after release.  Phases overlap so each motion hands over to the next.
  const SEQ = {
    unroll: [0.0, 1.55],
    turn: [1.25, 2.4],
    dock: [1.8, 2.85],      // the turning sheet shrinks and travels into the slot
    reveal: [2.1, 2.7],     // the cover fades once the papyrus has cleared the text below the slot
    shape: [2.6, 3.6],
    hasta: [3.5, 4.05],
    end: 4.1,
  };
  const IDLE = { period: 3.4, sway: 6, breath: 0.035, fadeIn: 0.4 };

  /* ---------------------------------------------------------------- helpers */
  const DEG = Math.PI / 180;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const clamp01 = (x) => clamp(x, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const phase = (t, span) => clamp01((t - span[0]) / (span[1] - span[0]));

  function bezierEase(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 40; i++) { const v = X(t); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return Y(t);
    };
  }
  const EASE = {
    unroll: bezierEase(0.5, 0.0, 0.2, 1.0),
    turn: bezierEase(0.5, 0.0, 0.3, 1.0),
    dock: bezierEase(0.55, 0.0, 0.2, 1.0),
    shape: bezierEase(0.45, 0.0, 0.25, 1.0),
    hasta: bezierEase(0.35, 0.0, 0.15, 1.0),
  };

  // Profile from curvature; anchor sample m at the origin with tangent angle theta.
  function integrate(K, N, ds, m, theta, U, V, TH) {
    TH[m] = theta;
    for (let i = m + 1; i < N; i++) TH[i] = TH[i - 1] + 0.5 * (K[i - 1] + K[i]) * ds;
    for (let i = m - 1; i >= 0; i--) TH[i] = TH[i + 1] - 0.5 * (K[i] + K[i + 1]) * ds;
    U[m] = 0; V[m] = 0;
    for (let i = m + 1; i < N; i++) { const a = 0.5 * (TH[i - 1] + TH[i]); U[i] = U[i - 1] + ds * Math.cos(a); V[i] = V[i - 1] + ds * Math.sin(a); }
    for (let i = m - 1; i >= 0; i--) { const a = 0.5 * (TH[i] + TH[i + 1]); U[i] = U[i + 1] - ds * Math.cos(a); V[i] = V[i + 1] - ds * Math.sin(a); }
  }

  /* --------------------------------------------------------------- the f */
  // Curvature of the f for a sheet of length L.  σ = distance from the nearer end.
  // Terminal: the rolls' spiral law κ = 1/√(r0² + hσ/π); stem: linear to 0 at the middle.
  // Odd about the middle (κ(L−s) = −κ(s)), hence a point-symmetric figure.
  function curvatureF(o, L, N, out) {
    const ds = L / (N - 1), half = L / 2, r0 = o.rollInner, h = o.rollGap;
    const t0 = o.termLen - o.termRamp / 2, t1 = o.termLen + o.termRamp / 2;
    const stemLen = Math.max(1e-6, half - o.termLen);
    for (let i = 0; i < N; i++) {
      const s = i * ds, sig = Math.min(s, L - s);
      const spiral = 1 / Math.sqrt(r0 * r0 + (h * sig) / Math.PI);
      const stem = (o.stemBend * Math.max(0, half - sig)) / stemLen;
      const w = 1 - smoothstep(t0, t1, sig);
      const k = w * spiral + (1 - w) * stem;
      out[i] = 2 * i < N - 1 ? k : 2 * i > N - 1 ? -k : 0;
    }
    return ds;
  }

  function designF(o) {
    const N = o.samples % 2 ? o.samples : o.samples + 1, m = (N - 1) / 2;
    const K = new Float64Array(N), U = new Float64Array(N), V = new Float64Array(N), TH = new Float64Array(N);
    const thetaC = -Math.PI / 2 - o.slant * DEG;
    const heightOf = (L) => {
      const ds = curvatureF(o, L, N, K);
      integrate(K, N, ds, m, thetaC, U, V, TH);
      let a = Infinity, b = -Infinity;
      for (let i = 0; i < N; i++) { if (V[i] < a) a = V[i]; if (V[i] > b) b = V[i]; }
      return b - a;
    };
    let lo = 2 * o.termLen + 10, hi = 1200;
    for (let it = 0; it < 60; it++) { const mid = 0.5 * (lo + hi); if (heightOf(mid) < o.height) lo = mid; else hi = mid; }
    const L = 0.5 * (lo + hi), ds = curvatureF(o, L, N, K);
    integrate(K, N, ds, m, thetaC, U, V, TH);
    let umax = 0;
    for (let i = 0; i < N; i++) umax = Math.max(umax, Math.abs(U[i]));
    return {
      N, m, L, ds, thetaC, kF: Float64Array.from(K),
      Uf: Float64Array.from(U), Vf: Float64Array.from(V),
      halfWidth: umax, bar: o.barRatio * umax,
    };
  }

  function buildModel(o) {
    const f = designF(o), N = f.N, L = f.L, ds = f.ds, r0 = o.rollInner, h = o.rollGap;
    const kT = new Float64Array(N), kB = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const s = i * ds;
      kT[i] = 1 / Math.sqrt(r0 * r0 + (h * s) / Math.PI);
      kB[i] = -1 / Math.sqrt(r0 * r0 + (h * (L - s)) / Math.PI);
    }
    const aEnd = Math.min(L / 2 - 5, o.termLen + o.extraCurl);
    return Object.assign(f, {
      kT, kB, sM: f.m * ds, aEnd, bEnd: L - aEnd,
      W: o.sheetWidth, yaw0: o.yawStart * DEG, openBend: o.openBend, liftOff: o.liftOff,
      K: new Float64Array(N), U: new Float64Array(N), V: new Float64Array(N), TH: new Float64Array(N),
    });
  }

  /* -------------------------------------------------------------- profile */
  // pu: unroll progress (0 = closed double roll, 1 = open), ps: shaping progress (1 = the f).
  function computeProfile(M, pu, ps) {
    const a = lerp(M.sM, M.aEnd, pu), b = lerp(M.sM, M.bEnd, pu); // wound: [0,a] and [b,L]
    const g = M.openBend * pu, D = M.liftOff, K = M.K;
    for (let i = 0; i < M.N; i++) {
      const s = i * M.ds;
      const wT = 1 - smoothstep(a - D / 2, a + D / 2, s);
      const wB = smoothstep(b - D / 2, b + D / 2, s);
      const kOpen = wT * M.kT[i] + wB * M.kB[i] + (1 - wT - wB) * g * M.kF[i];
      K[i] = kOpen + (M.kF[i] - kOpen) * ps;
    }
    integrate(K, M.N, M.ds, M.m, lerp(-Math.PI / 2, M.thetaC, 0.35 * pu + 0.65 * ps), M.U, M.V, M.TH);
  }

  // Half-extents (f-units) of the papyrus over the loader part of the motion.
  function measureLoader(M, o) {
    let mx = 1, my = 1;
    const hw = M.W / 2;
    for (let q = 0; q <= 40; q++) {
      const pu = q / 40;
      computeProfile(M, pu, 0);
      for (const phi of [M.yaw0 - IDLE.sway * DEG, M.yaw0, M.yaw0 + IDLE.sway * DEG, Math.PI / 2]) {
        const c = Math.cos(phi), s = Math.sin(phi);
        for (let i = 0; i < M.N; i += 2) {
          mx = Math.max(mx, Math.abs(hw * c + M.U[i] * s), Math.abs(-hw * c + M.U[i] * s));
          my = Math.max(my, Math.abs(M.V[i]));
        }
      }
    }
    return { x: mx, y: my };
  }

  /* ----------------------------------------------------------- visibility */
  function buildBuckets(M) {
    const { U, V, N } = M, B = 256;
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < N; i++) { if (V[i] < vmin) vmin = V[i]; if (V[i] > vmax) vmax = V[i]; }
    const inv = B / Math.max(vmax - vmin, 1e-9);
    const cnt = M.bCnt || (M.bCnt = new Int32Array(B + 1));
    const lo = M.bLo || (M.bLo = new Int32Array(N)), hi = M.bHi || (M.bHi = new Int32Array(N));
    const pos = M.bPos || (M.bPos = new Int32Array(B));
    cnt.fill(0);
    for (let k = 0; k < N - 1; k++) {
      lo[k] = Math.min(B - 1, ((Math.min(V[k], V[k + 1]) - vmin) * inv) | 0);
      hi[k] = Math.min(B - 1, ((Math.max(V[k], V[k + 1]) - vmin) * inv) | 0);
      for (let q = lo[k]; q <= hi[k]; q++) cnt[q + 1]++;
    }
    for (let q = 0; q < B; q++) cnt[q + 1] += cnt[q];
    if (!M.bItems || M.bItems.length < cnt[B]) M.bItems = new Int32Array(Math.max(cnt[B], 4 * N));
    for (let q = 0; q < B; q++) pos[q] = cnt[q];
    for (let k = 0; k < N - 1; k++) for (let q = lo[k]; q <= hi[k]; q++) M.bItems[pos[q]++] = k;
    M.bMin = vmin; M.bInv = inv; M.bB = B;
  }

  // Deepest fibre still in front of depth uLimit at height v (−∞ if none).
  function maxFront(M, v, uLimit, exLo, exHi) {
    const q = Math.min(M.bB - 1, Math.max(0, ((v - M.bMin) * M.bInv) | 0));
    const U = M.U, V = M.V, items = M.bItems;
    let best = -Infinity;
    for (let p = M.bCnt[q], e = M.bCnt[q + 1]; p < e; p++) {
      const k = items[p];
      if (k >= exLo && k <= exHi) continue;
      const v0 = V[k], v1 = V[k + 1];
      if ((v0 - v) * (v1 - v) > 0) continue;
      const dv = v1 - v0;
      const u = dv === 0 ? Math.min(U[k], U[k + 1]) : U[k] + ((U[k + 1] - U[k]) * (v - v0)) / dv;
      if (u < uLimit && u > best) best = u;
    }
    return best;
  }

  /* ----------------------------------------------------------------- draw */
  const EPS = 1e-4;

  // Draws the current profile (M.U, M.V).  cx, cy, k, lw in device pixels.
  function drawFrame(ctx, M, phi, hasta, cx, cy, k, lw, alpha, ink) {
    const { U, V, N } = M, hw = M.W / 2, c = Math.cos(phi), s = Math.sin(phi);
    const X = (x) => cx + x * k, Y = (y) => cy - y * k;
    buildBuckets(M);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();

    // Right-hand edge: seen from the right, nothing ever covers it.
    const xr = hw * c;
    ctx.moveTo(X(xr + U[0] * s), Y(V[0]));
    for (let i = 1; i < N; i++) ctx.lineTo(X(xr + U[i] * s), Y(V[i]));

    // Left-hand edge: hidden where a fibre in front of it reaches across.
    if (2 * hw * c * k > 0.35) {
      const xl = -hw * c, lim = (M.W * c) / Math.max(s, 1e-9);
      const hidden = (u, v, lo, hi) => { const b = maxFront(M, v, u - EPS, lo, hi); return b !== -Infinity && u - b <= lim; };
      let prev = hidden(U[0], V[0], -1, 1);
      if (!prev) ctx.moveTo(X(xl + U[0] * s), Y(V[0]));
      for (let i = 1; i < N; i++) {
        const h = hidden(U[i], V[i], i - 2, i + 1);
        if (h !== prev) {
          let lo = 0, hi = 1;
          for (let it = 0; it < 10; it++) {
            const md = 0.5 * (lo + hi);
            if (hidden(lerp(U[i - 1], U[i], md), lerp(V[i - 1], V[i], md), i - 3, i + 1) === prev) lo = md; else hi = md;
          }
          const md = 0.5 * (lo + hi);
          const px = X(xl + lerp(U[i - 1], U[i], md) * s), py = Y(lerp(V[i - 1], V[i], md));
          if (prev) { ctx.moveTo(px, py); ctx.lineTo(X(xl + U[i] * s), Y(V[i])); } else ctx.lineTo(px, py);
          prev = h;
        } else if (!h) ctx.lineTo(X(xl + U[i] * s), Y(V[i]));
      }
    }

    // Fibres that show as lines: folds (silhouettes, where the profile turns horizontal) and cut ends.
    if (2 * hw * c * k > 0.5) {
      const fibre = (uc, vc, lo, hi) => {
        let x0 = -hw * c + uc * s;
        const x1 = hw * c + uc * s, b = maxFront(M, vc, uc - EPS, lo, hi);
        if (b !== -Infinity) x0 = Math.max(x0, hw * c + b * s);
        if ((x1 - x0) * k > 0.5) { ctx.moveTo(X(x0), Y(vc)); ctx.lineTo(X(x1), Y(vc)); }
      };
      for (let i = 1; i < N - 1; i++) {
        const d1 = V[i] - V[i - 1], d2 = V[i + 1] - V[i];
        if (d1 * d2 < 0) {
          const den = V[i - 1] - 2 * V[i] + V[i + 1];
          const off = den !== 0 ? clamp((0.5 * (V[i - 1] - V[i + 1])) / den, -0.5, 0.5) : 0;
          fibre(U[i] + off * 0.5 * (U[i + 1] - U[i - 1]), V[i] - 0.25 * (V[i - 1] - V[i + 1]) * off, i - 3, i + 2);
        }
      }
      fibre(U[0], V[0], -1, 2);
      fibre(U[N - 1], V[N - 1], N - 4, N);
    }
    ctx.stroke();

    // The bar: level, centred on the stem, drawn left to right like a pen stroke.
    if (hasta > 0) {
      ctx.beginPath();
      ctx.moveTo(X(-M.bar * s), Y(0));
      ctx.lineTo(X(lerp(-M.bar, M.bar, hasta) * s), Y(0));
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ SVG of the f */
  // Smooth path through the finished f (Catmull-Rom → cubic Bézier), in box coordinates.
  function fPathData(M, cx, cy, k, step) {
    const pts = [];
    for (let i = 0; i < M.N; i += step) pts.push([cx + M.Uf[i] * k, cy - M.Vf[i] * k]);
    if ((M.N - 1) % step) pts.push([cx + M.Uf[M.N - 1] * k, cy - M.Vf[M.N - 1] * k]);
    const f = (x) => Math.round(x * 100) / 100;
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d;
  }

  function fSvg(M, o, w, h, cx, cy, k, lw, attrs) {
    const bar = `M${(cx - M.bar * k).toFixed(2)} ${cy.toFixed(2)}H${(cx + M.bar * k).toFixed(2)}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" fill="none" stroke="${o.ink}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"${attrs || ''}>` +
      `<path d="${fPathData(M, cx, cy, k, 6)}"/><path d="${bar}"/></svg>`;
  }

  /* -------------------------------------------------------------- runtime */
  const o = Object.assign({}, DEFAULTS, window.PAPYRUS_HERO || {});
  const M = buildModel(o);
  const root = document.documentElement;
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let ext = null, cover = null, canvas = null, ctx = null, dpr = 1, vw = 1, vh = 1;
  let state = 'idle', released = false, revealed = false, frozen = null;
  let tau = 0, T = 0, last = 0, raf = 0, slotEl = null;

  const emit = (name) => document.dispatchEvent(new CustomEvent(name));
  const findSlot = () => slotEl || (slotEl = document.querySelector(o.slot));

  function sizeCanvas() {
    const r = canvas.getBoundingClientRect();
    vw = r.width || window.innerWidth; vh = r.height || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(vw * dpr)); canvas.height = Math.max(1, Math.round(vh * dpr));
  }

  function mountCover() {
    cover = document.createElement('div');
    cover.setAttribute('aria-hidden', 'true');
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:' + o.background + ';';
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483001;pointer-events:none;';
    document.body.appendChild(cover);
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    sizeCanvas();
    addEventListener('resize', sizeCanvas);
  }

  // Where and how large: centred loader → the slot (f height = slot height × heroFill).
  function loaderPlacement() {
    if (!ext) ext = measureLoader(M, o);
    const k = Math.min((vh * o.loaderSize) / (2 * ext.y), (vw * 0.84) / (2 * ext.x), o.loaderMaxScale);
    return { cx: vw / 2, cy: vh / 2, k };
  }
  function heroPlacement() {
    const el = findSlot();
    if (!el) return { cx: vw / 2, cy: vh / 2, k: 176 / o.height };
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, k: (r.height * o.heroFill) / o.height };
  }

  // Loader idle: a slow sway about the vertical axis while the rolls breathe a little.
  function idleValues(t) {
    const w = (2 * Math.PI * t) / IDLE.period;
    return { pu: (IDLE.breath * (1 - Math.cos(w))) / 2, phi: M.yaw0 + IDLE.sway * DEG * Math.sin(w), alpha: smoothstep(0, IDLE.fadeIn, t) };
  }

  function current() {
    if (!released) {
      const iv = idleValues(tau);
      return { pu: iv.pu, ps: 0, phi: iv.phi, hasta: 0, dock: 0, cover: 1, alpha: iv.alpha };
    }
    const f = frozen, phiPre = lerp(f.phi, M.yaw0, smoothstep(0, 0.6, T));
    return {
      pu: Math.max(f.pu * (1 - smoothstep(0, 0.4, T)), EASE.unroll(phase(T, SEQ.unroll))),
      ps: EASE.shape(phase(T, SEQ.shape)),
      phi: lerp(phiPre, Math.PI / 2, EASE.turn(phase(T, SEQ.turn))),
      hasta: EASE.hasta(phase(T, SEQ.hasta)),
      dock: EASE.dock(phase(T, SEQ.dock)),
      cover: 1 - smoothstep(SEQ.reveal[0], SEQ.reveal[1], T),
      alpha: lerp(f.alpha, 1, smoothstep(0, 0.3, T)),
    };
  }

  function render() {
    const st = current(), A = loaderPlacement(), B = heroPlacement(), d = st.dock;
    const k = Math.exp(lerp(Math.log(A.k), Math.log(B.k), d));
    computeProfile(M, st.pu, st.ps);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(ctx, M, st.phi, st.hasta, lerp(A.cx, B.cx, d) * dpr, lerp(A.cy, B.cy, d) * dpr, k * dpr,
      lerp(o.lineLoader, o.lineHero, d) * dpr, st.alpha, o.ink);
    cover.style.opacity = String(st.cover);
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    if (cover) cover.style.pointerEvents = 'none';
    root.classList.remove('papyrus-loading');
    root.classList.add('papyrus-revealed');
    emit('papyrus:reveal');
  }

  // The finished f as an inline SVG inside the slot (crisp, scrolls with the page).
  function placeInSlot() {
    const el = findSlot();
    if (!el) return false;
    const r = el.getBoundingClientRect(), k = (r.height * o.heroFill) / o.height;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.className = 'papyrus-f';
    holder.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    holder.innerHTML = fSvg(M, o, r.width, r.height, r.width / 2, r.height / 2, k, o.lineHero,
      ' style="display:block;width:100%;height:100%;overflow:visible"');
    el.appendChild(holder);
    return true;
  }

  function finish() {
    cancelAnimationFrame(raf);
    reveal();
    const placed = placeInSlot();
    if (cover) cover.remove();
    if (placed && canvas) { canvas.remove(); removeEventListener('resize', sizeCanvas); }
    if (!placed) console.warn('papyrus-hero: no element matches', o.slot, '— the f stays on the canvas.');
    root.classList.add('papyrus-done');
    state = 'done';
    emit('papyrus:done');
  }

  function tick(now) {
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0; // real time; gaps (hidden tab) are capped
    last = now;
    if (released) T += dt * o.speed; else tau += dt;
    if (o.freezeAt != null && T > o.freezeAt) T = o.freezeAt;
    if (released && T >= SEQ.reveal[0]) reveal();
    render();
    if (released && T >= SEQ.end && o.freezeAt == null) return finish();
    raf = requestAnimationFrame(tick);
  }

  function release() {
    if (released || state !== 'loading') return;
    if (tau < o.minLoader) { setTimeout(release, (o.minLoader - tau) * 1000 + 20); return; }
    frozen = idleValues(tau);
    released = true;
    state = 'playing';
  }

  function boot() {
    if (reduce || o.skip) {
      const place = () => {
        state = 'done';
        root.classList.add('papyrus-revealed', 'papyrus-done');
        placeInSlot();
        emit('papyrus:reveal'); emit('papyrus:done');
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place, { once: true }); else place();
      return;
    }
    state = 'loading';
    root.classList.add('papyrus-loading');
    const go = () => { mountCover(); raf = requestAnimationFrame(tick); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
    if (o.release !== 'manual') {
      const loaded = new Promise((res) => (document.readyState === 'complete' ? res() : addEventListener('load', res, { once: true })));
      const fonts = document.fonts && document.fonts.ready ? document.fonts.ready.catch(() => {}) : Promise.resolve();
      Promise.all([loaded, fonts]).then(release);
      setTimeout(release, o.maxWait * 1000);
    }
  }

  window.PapyrusHeroV2 = {
    release,
    get state() { return state; },
    // The finished f on its own, e.g. for the nav logo: viewBox 0 0 100 150 like the current one.
    svg(stroke = 3.5) { return fSvg(M, o, 100, 150, 50, 75, 1, stroke); },
    options: o, sequence: SEQ,
    _internal: { DEFAULTS, IDLE, buildModel, computeProfile, drawFrame, measureLoader, fSvg, M,
      // Review aid: show the sequence at time t (s after release) at once, and hold it there.
      seek(t) {
        if (!canvas || state === 'done') return;
        if (!released) { frozen = idleValues(Math.max(tau, IDLE.fadeIn)); released = true; state = 'playing'; }
        o.freezeAt = T = Math.max(0, t);
        if (T >= SEQ.reveal[0]) reveal();
        render();
      },
    },
  };
  if (o.autostart) boot();
})();
