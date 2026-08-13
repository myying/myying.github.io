/* Gaussian hump — position errors break the Gaussian assumption
   (Chapter 6, section 1 widget).

   Model: the same Gaussian warm blob as Chapter 2 (peak A = 8 K, width
   SIG = 15 grid points = 135 km at dx = 9 km) on a 128 x 128 grid.

   The ensemble members differ ONLY in the location of the hump centre:
   centre = truth centre + N(0, L_sprd) in each direction.  L_sprd is
   given in units of the hump width SIG (slider range 0.1-3).  The
   observation point P sits southeast of the truth centre (compass
   135 deg), right on the 4 K contour, and the state watched at P is the
   temperature T there (4 K).

   Panels:
     (a) the hump ensemble — the 4 K ring of every member (thin, coloured)
         vs of the truth (thick); the observation point P is marked '+'.
     (b) the error distribution at P — histogram of the members'
         temperature T minus the truth value, with a Gaussian fit (dashed)
         through the same mean and std.  At small L_sprd the error is
         Gaussian; once L_sprd reaches ~SIG the histogram skews hard
         against the T = 0 bound.
     (c) the mechanism — temperature T at P as a function of the centre
         displacement toward P.  A bell curve peaking as the centre passes
         P: non-monotone, so a Gaussian cloud of centres does not map to a
         Gaussian temperature at P.

   Embedding-ready: root is the element with id="rankine" (falls back to
   .da-widget / document root), theme follows prefers-color-scheme via the
   data-theme attribute, and a ResizeObserver re-renders on reflow.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("rankine") || document.querySelector(".da-widget") || document.documentElement;
  const cvA = $("rk-plot-a"), cvB = $("rk-plot-b"), cvC = $("rk-plot-c");
  const sprdSlider = $("rk-sprd"), sprdVal = $("rk-sprd-val");
  const nensSlider = $("rk-nens"), nensVal = $("rk-nens-val");
  const rerunBtn = $("rk-rerun");

  /* ------------------------------------------------------------- model */
  const A = 8, SIG = 15;               // hump peak (K), width (grid points = 135 km)
  const RING = 4;                      // K contour shown in panel (a)
  const NENS_MIN = 20, NENS_MAX = 400;
  let NENS = 100;                    // ensemble size (tunable)
  const DX = 9.0;                      // km per grid point
  const C_I = 64, C_J = 64;            // truth centre (0.5 * 128)
  const P_ANG0 = 135 * Math.PI / 180;  // default obs point: compass 135° = southeast
  const P_DIR0 = { i: Math.sin(P_ANG0), j: -Math.cos(P_ANG0) };   // (0.7071, 0.7071)
  const R0_0 = SIG * Math.sqrt(2 * Math.log(2));  // default: right on the 4 K contour
  let P_I = C_I + R0_0 * P_DIR0.i, P_J = C_J + R0_0 * P_DIR0.j;   // obs point (clickable)
  let P_DIR = P_DIR0;                  // unit vector from the truth centre toward P
  let R0 = R0_0;                       // distance truth centre -> P (grid points)

  // temperature of the Gaussian hump at (x, y) from a centre at (ci, cj)
  function field(ci, cj, x, y) {
    const r2 = (x - ci) * (x - ci) + (y - cj) * (y - cj);
    return A * Math.exp(-r2 / (2 * SIG * SIG));
  }
  let V_T = field(C_I, C_J, P_I, P_J);   // truth temperature at P
  // radius of the RING K contour around a centre (analytic)
  function ringRadii() {
    return [SIG * Math.sqrt(2 * Math.log(A / RING))];
  }
  // standard normal via Box-Muller (2 values per call)
  let _spare = null;
  function gauss() {
    if (_spare !== null) { const s = _spare; _spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const m = Math.sqrt(-2 * Math.log(u));
    _spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }

  let Lsprd = SIG;                     // location spread (grid points, default 1 sigma)
  let ci = new Float64Array(NENS), cj = new Float64Array(NENS);

  function sampleEnsemble() {
    for (let m = 0; m < NENS; m++) {
      ci[m] = C_I + gauss() * Lsprd;
      cj[m] = C_J + gauss() * Lsprd;
    }
  }

  /* ------------------------------------------------------------- theme */
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const T = {
    surface1: "#fcfcfb", surface2: "#f9f9f7", hair: "#f3f2ef",
    ink1: "#0b0b0b", ink2: "#52514e", ink3: "#898781",
    line: "#e1e0d9", axis: "#c3c2b7", red: "#e34948", amber: "#eda100"
  };
  const updateT = () => {
    const kv = (n, f) => { const v = cssVar(n); if (v) f(v); };
    kv("--surface-1", v => T.surface1 = v); kv("--surface-2", v => T.surface2 = v);
    kv("--surface-hair", v => T.hair = v);
    kv("--ink-1", v => T.ink1 = v); kv("--ink-2", v => T.ink2 = v); kv("--ink-3", v => T.ink3 = v);
    kv("--line", v => T.line = v); kv("--axis", v => T.axis = v);
    kv("--series-red", v => T.red = v); kv("--series-amber", v => T.amber = v);
  };
  updateT();

  // member palette (Tab20-style cycle)
  const MEM_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  const memColor = (m) => MEM_COLORS[m % MEM_COLORS.length];

  /* ------------------------------------------------------------- canvas */
  const dpr = window.devicePixelRatio || 1;
  function sizeCanvas(cv) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return [ctx, w, h];
  }
  function hexA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  /* ------------------------------------------------------- panel (a) */
  const WIN = 30;                       // half-window in grid points
  const TICKS_KM = [-270, -180, -90, 0, 90, 180, 270];

  // geometry of the (a) map square inside the canvas (shared by renderA and the click handler).
  // Same margins as panels (b)/(c) so the plotting areas line up; the square fills the plot area
  // (the canvas aspect 321/309 makes its height just fit).
  function aGeom(W, H) {
    const margin = { l: 46, r: 12, t: 14, b: 32 };
    const pw = W - margin.l - margin.r;
    const ph = H - margin.t - margin.b;
    const side = Math.min(pw, ph);
    const x0 = margin.l + (pw - side) / 2;
    return { margin, side, x0, y0: margin.t, s: side / (2 * WIN) };
  }

  function renderA() {
    const [ctx, W, H] = sizeCanvas(cvA);
    const { margin, side, x0, y0, s } = aGeom(W, H);

    // wind-field shading is intentionally omitted: the panel shows only the
    // 4 K contour rings of the truth (thick, white) and of every member
    // (thin, coloured) on the plain surface

    // 4 K rings of the members (thin, coloured), clipped to the axes
    const radii = ringRadii();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, side, side);
    ctx.clip();
    ctx.lineWidth = 1;
    for (let m = 0; m < NENS; m++) {
      ctx.strokeStyle = hexA(memColor(m), 0.32);
      for (const r of radii) {
        ctx.beginPath();
        ctx.arc(x0 + (ci[m] - (C_I - WIN)) * s, y0 + (cj[m] - (C_J - WIN)) * s, r * s, 0, 6.2832);
        ctx.stroke();
      }
    }

    // truth rings (thick)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 2.6;
    for (const r of radii) {
      ctx.beginPath();
      ctx.arc(x0 + WIN * s, y0 + WIN * s, r * s, 0, 6.2832);
      ctx.stroke();
    }
    ctx.restore();

    // observation point P — white cross with a dark halo (reads in both themes)
    const px = x0 + (P_I - (C_I - WIN)) * s, py = y0 + (P_J - (C_J - WIN)) * s;
    const ms = 7;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 4.6;
    ctx.beginPath();
    ctx.moveTo(px - ms, py); ctx.lineTo(px + ms, py);
    ctx.moveTo(px, py - ms); ctx.lineTo(px, py + ms);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(px - ms, py); ctx.lineTo(px + ms, py);
    ctx.moveTo(px, py - ms); ctx.lineTo(px, py + ms);
    ctx.stroke();
    ctx.lineCap = "butt";

    // axes
    ctx.strokeStyle = T.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, side, side);
    ctx.fillStyle = T.ink3;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const km of TICKS_KM) {
      const xi = x0 + (km / DX + WIN) * s;
      ctx.beginPath();
      ctx.moveTo(xi, y0 + side); ctx.lineTo(xi, y0 + side + 4);
      ctx.stroke();
      ctx.fillText(String(km), xi, y0 + side + 6);
    }
    // y-axis ticks + labels (km north)
    ctx.textBaseline = "middle";
    for (const km of TICKS_KM) {
      const yi = y0 + (km / DX + WIN) * s;
      ctx.beginPath();
      ctx.moveTo(x0, yi); ctx.lineTo(x0 - 4, yi);
      ctx.stroke();
      ctx.fillText(String(km), x0 - 6, yi);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("km", x0 + side / 2, y0 + side + 18);   // unit centred below the axis
  }

  /* ------------------------------------------------------- panel (b) */
  function renderB() {
    const [ctx, W, H] = sizeCanvas(cvB);
    const margin = { l: 46, r: 12, t: 14, b: 30 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;

    // member errors at P
    const e = new Float64Array(NENS);
    let sum = 0;
    for (let m = 0; m < NENS; m++) { e[m] = field(ci[m], cj[m], P_I, P_J) - V_T; sum += e[m]; }
    const mu = sum / NENS;
    let v2 = 0, v3 = 0, v4 = 0;
    for (let m = 0; m < NENS; m++) {
      const d = e[m] - mu;
      v2 += d * d; v3 += d * d * d; v4 += d * d * d * d;
    }
    const sd = Math.sqrt(v2 / NENS);
    const skew = (v3 / NENS) / Math.pow(sd, 3);
    const kurt = (v4 / NENS) / Math.pow(sd, 4) - 3;

    // fixed x range, anchored to the truth temperature at P: e = T - T_truth always
    // lies in [-T_t, A - T_t] plus a margin.  Constant under Lsprd changes;
    // re-anchors (and only then) when P is moved by clicking the map in panel (a).
    const lo = -V_T - 1.5, hi = A - V_T + 1.5;
    const NB = 48;
    const binW = (hi - lo) / NB;
    const counts = new Float64Array(NB);
    for (let m = 0; m < NENS; m++) {
      let b = Math.floor((e[m] - lo) / binW);
      if (b < 0) b = 0; if (b >= NB) b = NB - 1;
      counts[b]++;
    }
    const cmax = Math.max.apply(null, counts);

    // bars
    for (let b = 0; b < NB; b++) {
      const bx = margin.l + b * binW / (hi - lo) * pw;
      const bw = Math.max(1, binW / (hi - lo) * pw - 1);
      const bh = (counts[b] / cmax) * ph * 0.72;   // y-range padded: top ~28% stays free for the legend box
      ctx.fillStyle = theme === "dark" ? hexA(T.amber, 0.5) : hexA(T.amber, 0.32);
      ctx.fillRect(bx, margin.t + ph - bh, bw, bh);
    }

    // kernel density estimate of the error (Gaussian kernel, Silverman bandwidth)
    const es = Array.from(e).sort((a, b) => a - b);
    const iqr = es[Math.floor(0.75 * NENS)] - es[Math.floor(0.25 * NENS)];
    const h = Math.max(0.2, 0.9 * Math.min(sd, iqr / 1.34) * Math.pow(NENS, -0.2));
    const k2p = Math.sqrt(2 * Math.PI);
    ctx.strokeStyle = T.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const NPTS = 220;
    for (let i = 0; i <= NPTS; i++) {
      const x = lo + (hi - lo) * i / NPTS;
      let s = 0;
      for (let m = 0; m < NENS; m++) { const z = (x - e[m]) / h; s += Math.exp(-0.5 * z * z); }
      const f = s / (NENS * h * k2p);
      const cy = margin.t + ph - (f * binW * NENS) / cmax * ph * 0.72;
      if (i === 0) ctx.moveTo(margin.l + (x - lo) / (hi - lo) * pw, cy);
      else ctx.lineTo(margin.l + (x - lo) / (hi - lo) * pw, cy);
    }
    ctx.stroke();

    // Gaussian fit (same mean & std)
    ctx.strokeStyle = T.ink2;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const yOf = (x) => margin.t + ph - (Math.exp(-0.5 * Math.pow((x - mu) / sd, 2)) /
      (sd * Math.sqrt(2 * Math.PI)) * binW * NENS) / cmax * ph * 0.72;
    for (let i = 0; i <= 120; i++) {
      const x = lo + (hi - lo) * i / 120;
      const y = yOf(x);
      if (i === 0) ctx.moveTo(margin.l + (x - lo) / (hi - lo) * pw, y);
      else ctx.lineTo(margin.l + (x - lo) / (hi - lo) * pw, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // truth (the error is zero at the truth: u = u_true at P)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 1.4;
    const tx = margin.l + ((0 - lo) / (hi - lo)) * pw;
    ctx.beginPath(); ctx.moveTo(tx, margin.t + 4); ctx.lineTo(tx, margin.t + ph); ctx.stroke();

    // "truth" tag on the line itself, at its lower end (the legend box takes the top)
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const truthLabel = "truth";
    const tw = ctx.measureText(truthLabel).width;
    const ly = margin.t + ph - 8;
    ctx.fillStyle = hexA(T.surface1, 0.85);
    ctx.fillRect(tx - tw / 2 - 3, ly - 12, tw + 6, 13);
    ctx.fillStyle = T.ink1;
    ctx.fillText(truthLabel, tx, ly + 1);
    ctx.textBaseline = "top";

    // axis (ticks: nice step over the anchored range)
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
    ctx.strokeRect(margin.l, margin.t, pw, ph);
    ctx.fillStyle = T.ink3; ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const step = niceStep((hi - lo) / 5);
    const t0 = Math.ceil(lo / step) * step;
    for (let v = t0; v <= hi + 1e-9; v += step) {
      const xi = margin.l + ((v - lo) / (hi - lo)) * pw;
      ctx.beginPath(); ctx.moveTo(xi, margin.t + ph); ctx.lineTo(xi, margin.t + ph + 4); ctx.stroke();
      ctx.fillText(String(Math.round(v * 10) / 10), xi, margin.t + ph + 6);
    }
    ctx.textAlign = "center";
    ctx.fillText("K", margin.l + pw / 2, margin.t + ph + 18);   // unit centred below the axis

    // readout spans
    const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
    $("rk-skew").textContent = f2(skew);
    $("rk-kurt").textContent = f2(kurt);
    const verdictEl = $("rk-verdict");
    // z-scores for skewness and excess kurtosis (Kim 2013; D'Agostino 1970):
    // SE(skew) = sqrt(6/n), SE(kurt) = sqrt(24/n), so the thresholds adapt to NENS.
    // 5% two-tailed critical value 1.96 (≈ "Gaussian" when both |z| < 1.96).
    const zSkew = skew / Math.sqrt(6 / NENS);
    const zKurt = kurt / Math.sqrt(24 / NENS);
    const gaussLike = Math.abs(zSkew) < 1.96 && Math.abs(zKurt) < 1.96;
    let txt;
    if (gaussLike) txt = "≈ Gaussian";
    else {
      const parts = [];
      if (zSkew < -1.96) parts.push("left-skewed");
      else if (zSkew > 1.96) parts.push("right-skewed");
      else parts.push("symmetric");
      if (zKurt < -1.96) parts.push("flat-topped");
      else if (zKurt > 1.96) parts.push("heavy-tailed");
      txt = "non-Gaussian — " + parts.join(", ");
    }
    verdictEl.textContent = txt;
    verdictEl.style.color = gaussLike ? T.amber : T.red;
    $("rk-mean").textContent = (mu >= 0 ? "+" : "") + mu.toFixed(1);
    $("rk-std").textContent = sd.toFixed(1);
  }

  /* ------------------------------------------------------- panel (c) */
  const D_MIN = -20, D_MAX = 20;       // displacement range (grid points)

  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / pow;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
  }

  function renderC() {
    const [ctx, W, H] = sizeCanvas(cvC);
    const margin = { l: 46, r: 12, t: 14, b: 32 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;
    const xOf = (d) => margin.l + (d - D_MIN) / (D_MAX - D_MIN) * pw;
    const yOf = (v) => margin.t + ph - (v - (-1)) / (10) * ph;   // v in [-1, 9] — padded top leaves room for the legend box

    // location pdf (Gaussian, std = Lsprd) as a shaded hump on the axis
    const pdf = (d) => Math.exp(-0.5 * Math.pow(d / Lsprd, 2)) / (Lsprd * Math.sqrt(2 * Math.PI));
    const pmax = pdf(0);
    const hump = 0.42 * ph;
    ctx.fillStyle = hexA(T.amber, 0.22);
    ctx.beginPath();
    ctx.moveTo(xOf(D_MIN), margin.t + ph);
    for (let i = 0; i <= 160; i++) {
      const d = D_MIN + (D_MAX - D_MIN) * i / 160;
      ctx.lineTo(xOf(d), margin.t + ph - hump * pdf(d) / pmax);
    }
    ctx.lineTo(xOf(D_MAX), margin.t + ph);
    ctx.closePath();
    ctx.fill();

    // the map: temperature T at P vs centre displacement toward P
    // (peaks as the centre reaches P, falls on both sides)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const d = D_MIN + (D_MAX - D_MIN) * i / 300;
      const v = field(C_I + d * P_DIR.i, C_J + d * P_DIR.j, P_I, P_J);
      if (i === 0) ctx.moveTo(xOf(d), yOf(v));
      else ctx.lineTo(xOf(d), yOf(v));
    }
    ctx.stroke();

    // "truth" tag next to the curve, at its left end (the legend entry was removed)
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    const truthTag = "truth";
    const ttw = ctx.measureText(truthTag).width;
    const vL = field(C_I + D_MIN * P_DIR.i, C_J + D_MIN * P_DIR.j, P_I, P_J);
    const ty = yOf(vL) - 18;
    ctx.fillStyle = hexA(T.surface1, 0.85);
    ctx.fillRect(margin.l + 4, ty, ttw + 6, 13);
    ctx.fillStyle = T.ink1;
    ctx.fillText(truthTag, margin.l + 7, ty + 2);
    ctx.textBaseline = "top";

    // member samples: (centre displacement toward P, zonal wind u at P)
    // points outside the axes range are skipped
    for (let m = 0; m < NENS; m++) {
      const d = (ci[m] - C_I) * P_DIR.i + (cj[m] - C_J) * P_DIR.j;
      const x = xOf(d), y = yOf(field(ci[m], cj[m], P_I, P_J));
      if (x < margin.l || x > margin.l + pw || y < margin.t || y > margin.t + ph) continue;
      ctx.fillStyle = hexA(memColor(m), 0.4);
      ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }

    // truth point
    ctx.fillStyle = T.ink1;
    ctx.beginPath(); ctx.arc(xOf(0), yOf(V_T), 4, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = T.surface1; ctx.lineWidth = 1.4;
    ctx.stroke();

    // reference line: the centre passes P (u reverses sign there)
    ctx.strokeStyle = hexA(T.ink3, 0.8);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xOf(R0), margin.t); ctx.lineTo(xOf(R0), margin.t + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = T.ink3;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("centre at P — max T", xOf(R0), margin.t + 2);

    // axes
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
    ctx.strokeRect(margin.l, margin.t, pw, ph);
    ctx.fillStyle = T.ink3;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const km of [-180, -90, 0, 90, 180]) {
      const d = km / DX;
      if (d < D_MIN || d > D_MAX) continue;
      const xi = xOf(d);
      ctx.beginPath(); ctx.moveTo(xi, margin.t + ph); ctx.lineTo(xi, margin.t + ph + 4); ctx.stroke();
      ctx.fillText(String(km), xi, margin.t + ph + 6);
    }
    ctx.textAlign = "center";
    ctx.fillText("km", margin.l + pw / 2, margin.t + ph + 18);   // unit centred below the axis
    ctx.save();
    ctx.translate(12, margin.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("temperature T at P (K)", 0, 0);
    ctx.restore();
  }

  /* ------------------------------------------------------------ glue */
  const obsPosEl = $("rk-obs-pos");

  // move the observation point (grid coordinates) and re-derive everything that follows
  function setP(gi, gj) {
    const di = gi - C_I, dj = gj - C_J;
    const r = Math.hypot(di, dj);
    P_I = gi; P_J = gj;
    if (r >= 0.5) { P_DIR = { i: di / r, j: dj / r }; R0 = r; }
    else R0 = 0;                       // P on the centre: direction undefined, keep the last one
    V_T = field(C_I, C_J, P_I, P_J);
    updateObsPos();
    render();
  }
  function updateObsPos() {
    if (!obsPosEl) return;
    const ang = (Math.atan2(P_I - C_I, -(P_J - C_J)) * 180 / Math.PI + 360) % 360;
    obsPosEl.textContent = "r = " + Math.round(R0 * DX) + " km · " + Math.round(ang)
      + "° · T\u209C = " + V_T.toFixed(1) + " K";
  }

  // click on the (a) map to move P
  cvA.addEventListener("click", (ev) => {
    const rect = cvA.getBoundingClientRect();
    const g = aGeom(cvA.clientWidth, cvA.clientHeight);
    const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    if (cx < g.x0 || cx > g.x0 + g.side || cy < g.y0 || cy > g.y0 + g.side) return;
    setP(C_I - WIN + (cx - g.x0) / g.s, C_J - WIN + (cy - g.y0) / g.s);
  });

  function render() { updateT(); renderA(); renderB(); renderC(); }

  sprdSlider.addEventListener("input", () => {
    Lsprd = parseFloat(sprdSlider.value) * SIG;   // slider is in units of sigma
    sprdVal.innerHTML = sprdSlider.value + " &sigma;";
    sampleEnsemble();
    render();
  });
  nensSlider.addEventListener("input", () => {
    NENS = parseInt(nensSlider.value, 10);
    nensVal.textContent = NENS;
    const lbl = $("rk-nens-label");
    if (lbl) lbl.textContent = NENS;
    ci = new Float64Array(NENS);
    cj = new Float64Array(NENS);
    sampleEnsemble();
    render();
  });
  rerunBtn.addEventListener("click", () => { sampleEnsemble(); render(); });

  root.dataset.theme = theme;           // apply theme variables before the first render
  updateObsPos();
  sprdSlider.value = (Lsprd / SIG).toFixed(1);   // put the slider head back at the default (1.0 sigma)
  sprdVal.innerHTML = (Lsprd / SIG).toFixed(1) + " &sigma;";
  nensSlider.value = NENS;
  nensVal.textContent = NENS;
  const nensLbl = $("rk-nens-label");
  if (nensLbl) nensLbl.textContent = NENS;
  sampleEnsemble();
  render();

  const ro = new ResizeObserver(render);
  [cvA, cvB, cvC].forEach((cv) => ro.observe(cv));
})();
