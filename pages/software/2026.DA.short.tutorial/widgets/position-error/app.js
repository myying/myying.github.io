/* Gaussian hump — position errors break the Gaussian assumption
   (Chapter 6, section 1 widget).

   Model: the exact same Gaussian warm blob as Chapter 2's generate_data.py
   (peak A = 8 K, radius scale SIG = blob_sig = 0.1 * domain width = 5 grid
   points = 50 km — the |grad T| max radius, i.e. Chapter 2's actual
   parameter, not a guess), on the same dx = 10 km grid spacing and the same
   500 x 500 km domain as Chapter 2 (the section-2 particle-filter/EnKF
   widget below uses a wider window instead, since its members must stay
   on-screen up to a much larger L_sprd).

   The ensemble members differ ONLY in the location of the hump centre:
   centre = truth centre + N(0, L_sprd) in each direction.  L_sprd is
   given in units of the hump width SIG (slider range 0.1-3).  The
   observation point P sits at the exact same grid offset from the truth
   centre as Chapter 2's own observation from its blob peak (obs (28,22)
   minus peak (24,24) = +40 km east, -20 km north; ENE) — not on the 4 K
   contour, same as in Chapter 2 — and the state watched at P is the
   temperature T there.

   Panels:
     (a) the hump ensemble — the 4 K ring of every member (thin, coloured),
         the truth ring haloed and thick, the selected member highlighted
         (thick + blob-centre dot); the observation point P is marked '+'.
     (b) the member distribution at P — histogram of the members'
         temperature T (not the error), with a Gaussian fit (dashed)
         through the same mean and std.  At small L_sprd the distribution
         is Gaussian; once L_sprd reaches ~SIG it skews hard against the
         T = 0 bound.
     (c) the mechanism — temperature T at P as a function of the centre
         displacement toward P.  A bell curve peaking as the centre passes
         P: non-monotone, so a Gaussian cloud of centres does not map to a
         Gaussian temperature at P.  Click a member's dot to highlight it
         here and in panel (a).

   Embedding-ready: root is the element with id="position-error" (falls back to
   .da-widget / document root), theme follows prefers-color-scheme via the
   data-theme attribute, and a ResizeObserver re-renders on reflow.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("position-error") || document.querySelector(".da-widget") || document.documentElement;
  const cvA = $("pe-plot-a"), cvB = $("pe-plot-b"), cvC = $("pe-plot-c");
  const sprdSlider = $("pe-sprd"), sprdVal = $("pe-sprd-val");
  const nensSlider = $("pe-nens"), nensVal = $("pe-nens-val");
  const rerunBtn = $("pe-rerun");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ------------------------------------------------------------- model */
  // SIG = blob_sig = 0.1 * Lx from Ch. 2's generate_data.py (Lx = 500 km),
  // the radius where |grad T| is greatest for this Gaussian form — Ch. 2's
  // actual parameter, confirmed from its data-generation script, not a guess.
  const A = 8, SIG = 5;                 // hump peak (K), radius scale (grid points = 50 km)
  const RING = 4;                      // K contour shown in panel (a)
  const NENS_MIN = 20, NENS_MAX = 400;
  let NENS = 100;                    // ensemble size (tunable)
  const DX = 10.0;                     // km per grid point (the Ch. 2 grid setting)
  const C_I = 64, C_J = 64;            // truth centre (0.5 * 128)
  // obs point: the exact same grid offset as Ch. 2's own observation from its
  // blob peak (obs (28,22) minus peak (24,24) = +4,-2 grid cells; both grids
  // use dx = 10 km, so the offset carries over directly). Not on the 4 K
  // contour — same as in Ch. 2 (Ch. 2's own obs isn't tied to any contour).
  const CH2_OFFSET_GP = { i: 28 - 24, j: 22 - 24 };
  const CH2_DIR_MAG = Math.hypot(CH2_OFFSET_GP.i, CH2_OFFSET_GP.j);
  const P_DIR0 = { i: CH2_OFFSET_GP.i / CH2_DIR_MAG, j: CH2_OFFSET_GP.j / CH2_DIR_MAG };
  let P_I = C_I + CH2_OFFSET_GP.i, P_J = C_J + CH2_OFFSET_GP.j;   // obs point (clickable)
  let P_DIR = P_DIR0;                  // unit vector from the truth centre toward P
  let R0 = CH2_DIR_MAG;                // distance truth centre -> P (grid points)
  let sel = 0;                         // highlighted member (0-based), set by clicking panel (c)

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
  const WIN = 25;                       // half-window in grid points — ±250 km at
  // dx = 10 km, i.e. the same 500 x 500 km domain as Chapter 2 (the
  // section-2 spaghetti panels use a wider window instead, since that
  // widget's members must stay on-screen up to a much larger L_sprd)
  const TICKS_KM = [-200, -100, 0, 100, 200];

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

    // 4 K rings of the members (thin, coloured), clipped to the axes; the
    // ring is exactly a circle here (isotropic Gaussian hump), so it is drawn
    // analytically rather than by marching squares — same curve, cheaper.
    // The selected member is skipped here and drawn on top, highlighted.
    const radii = ringRadii();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, side, side);
    ctx.clip();

    // projection axis: the line through the truth centre and P that panel
    // (c)'s x-axis (displacement toward P) is measured along
    const reach = WIN * Math.SQRT2;
    const ax0 = x0 + (C_I - reach * P_DIR.i - (C_I - WIN)) * s, ay0 = y0 + (C_J - reach * P_DIR.j - (C_J - WIN)) * s;
    const ax1 = x0 + (C_I + reach * P_DIR.i - (C_I - WIN)) * s, ay1 = y0 + (C_J + reach * P_DIR.j - (C_J - WIN)) * s;
    ctx.save();
    ctx.strokeStyle = hexA(T.ink3, 0.7);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ax0, ay0); ctx.lineTo(ax1, ay1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.lineWidth = 1;
    for (let m = 0; m < NENS; m++) {
      if (m === sel) continue;
      ctx.strokeStyle = hexA(memColor(m), 0.45);
      for (const r of radii) {
        ctx.beginPath();
        ctx.arc(x0 + (ci[m] - (C_I - WIN)) * s, y0 + (cj[m] - (C_J - WIN)) * s, r * s, 0, 6.2832);
        ctx.stroke();
      }
    }

    // selected member: thick, full opacity + blob centre dot
    if (sel < NENS) {
      ctx.strokeStyle = memColor(sel);
      ctx.lineWidth = 2.4;
      for (const r of radii) {
        ctx.beginPath();
        ctx.arc(x0 + (ci[sel] - (C_I - WIN)) * s, y0 + (cj[sel] - (C_J - WIN)) * s, r * s, 0, 6.2832);
        ctx.stroke();
      }
    }

    // truth 4 K ring: halo + ink core so it reads on every colour
    ctx.strokeStyle = theme === "dark" ? "#241439" : "#ffffff";
    ctx.lineWidth = 3.4;
    ctx.globalAlpha = 0.95;
    for (const r of radii) {
      ctx.beginPath();
      ctx.arc(x0 + WIN * s, y0 + WIN * s, r * s, 0, 6.2832);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 1.6;
    for (const r of radii) {
      ctx.beginPath();
      ctx.arc(x0 + WIN * s, y0 + WIN * s, r * s, 0, 6.2832);
      ctx.stroke();
    }
    ctx.restore();

    // selected member's blob centre dot (outside the clip, like the Ch. 2 panel)
    if (sel < NENS) {
      const cxm = x0 + (ci[sel] - (C_I - WIN)) * s, cym = y0 + (cj[sel] - (C_J - WIN)) * s;
      ctx.beginPath();
      ctx.arc(cxm, cym, 4.5, 0, 6.2832);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = memColor(sel);
      ctx.stroke();
    }

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

    // member temperature values at P (not the error against the truth)
    const e = new Float64Array(NENS);
    let sum = 0;
    for (let m = 0; m < NENS; m++) { e[m] = field(ci[m], cj[m], P_I, P_J); sum += e[m]; }
    const mu = sum / NENS;
    let v2 = 0, v3 = 0, v4 = 0;
    for (let m = 0; m < NENS; m++) {
      const d = e[m] - mu;
      v2 += d * d; v3 += d * d * d; v4 += d * d * d * d;
    }
    const sd = Math.sqrt(v2 / NENS);
    const skew = (v3 / NENS) / Math.pow(sd, 3);
    const kurt = (v4 / NENS) / Math.pow(sd, 4) - 3;

    // fixed x range: T at P always lies in [0, A] plus a margin. Constant
    // under Lsprd changes; re-anchors (and only then) when P is moved by
    // clicking the map in panel (a) — the range does not depend on P.
    const lo = -1.5, hi = A + 1.5;
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
      const bh = (counts[b] / cmax) * ph * 0.6;    // y-range padded: top ~40% stays free for the legend box
      ctx.fillStyle = theme === "dark" ? hexA(T.amber, 0.5) : hexA(T.amber, 0.32);
      ctx.fillRect(bx, margin.t + ph - bh, bw, bh);
    }

    // kernel density estimate of the member values (Gaussian kernel, Silverman bandwidth)
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
      const cy = margin.t + ph - (f * binW * NENS) / cmax * ph * 0.6;
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
      (sd * Math.sqrt(2 * Math.PI)) * binW * NENS) / cmax * ph * 0.6;
    for (let i = 0; i <= 120; i++) {
      const x = lo + (hi - lo) * i / 120;
      const y = yOf(x);
      if (i === 0) ctx.moveTo(margin.l + (x - lo) / (hi - lo) * pw, y);
      else ctx.lineTo(margin.l + (x - lo) / (hi - lo) * pw, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // truth value at P (T_truth)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 1.4;
    const tx = margin.l + ((V_T - lo) / (hi - lo)) * pw;
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
    ctx.fillText("T at P (K)", margin.l + pw / 2, margin.t + ph + 18);   // unit centred below the axis

    // readout spans
    const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
    $("pe-skew").textContent = f2(skew);
    $("pe-kurt").textContent = f2(kurt);
    const verdictEl = $("pe-verdict");
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
    $("pe-mean").textContent = (mu >= 0 ? "+" : "") + mu.toFixed(1);
    $("pe-std").textContent = sd.toFixed(1);
  }

  /* ------------------------------------------------------- panel (c) */
  const D_MIN = -20, D_MAX = 30;        // displacement range (grid points) — wide
  // enough for the whole T(P) bell (peak at R0 ~ 4.5 gp, tails ~ +-15 gp) and
  // the member samples at the default L_sprd

  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / pow;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
  }

  // geometry of panel (c)'s plot area, shared by renderC and the click handler
  const C_MARGIN = { l: 46, r: 12, t: 14, b: 32 };
  function cGeom(W, H) {
    const pw = W - C_MARGIN.l - C_MARGIN.r, ph = H - C_MARGIN.t - C_MARGIN.b;
    const xOf = (d) => C_MARGIN.l + (d - D_MIN) / (D_MAX - D_MIN) * pw;
    // y-range padded well above the field's peak (A = 8 K) so the legend box
    // has clear room at the top of the panel, same convention as panel (b)
    const yOf = (v) => C_MARGIN.t + ph - (v - (-1)) / (13) * ph;
    return { margin: C_MARGIN, pw, ph, xOf, yOf };
  }

  function renderC() {
    const [ctx, W, H] = sizeCanvas(cvC);
    const { margin, pw, ph, xOf, yOf } = cGeom(W, H);

    // location pdf (Gaussian, std = Lsprd) as a shaded hump on the axis,
    // drawn to true relative scale: height is proportional to the density
    // (not renormalized to a fixed peak every frame), so it visibly narrows
    // and tallens as L_sprd shrinks, and widens and flattens as it grows —
    // a real pdf, not just a fixed-height silhouette. Scale is pinned so the
    // peak reaches 42% of the plot height at the default L_sprd = SIG;
    // clipped to the plot area since small L_sprd pushes the peak far above it.
    const pdf = (d) => Math.exp(-0.5 * Math.pow(d / Lsprd, 2)) / (Lsprd * Math.sqrt(2 * Math.PI));
    const PDF_SCALE = 0.42 * ph * SIG * Math.sqrt(2 * Math.PI);
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.l, margin.t, pw, ph);
    ctx.clip();
    ctx.fillStyle = hexA(T.amber, 0.22);
    ctx.beginPath();
    ctx.moveTo(xOf(D_MIN), margin.t + ph);
    for (let i = 0; i <= 160; i++) {
      const d = D_MIN + (D_MAX - D_MIN) * i / 160;
      ctx.lineTo(xOf(d), margin.t + ph - PDF_SCALE * pdf(d));
    }
    ctx.lineTo(xOf(D_MAX), margin.t + ph);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

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
    // points outside the axes range are skipped. Click a dot to highlight
    // that member here and in panel (a) (see the click handler below).
    for (let m = 0; m < NENS; m++) {
      if (m === sel) continue;
      const d = (ci[m] - C_I) * P_DIR.i + (cj[m] - C_J) * P_DIR.j;
      const x = xOf(d), y = yOf(field(ci[m], cj[m], P_I, P_J));
      if (x < margin.l || x > margin.l + pw || y < margin.t || y > margin.t + ph) continue;
      ctx.fillStyle = hexA(memColor(m), 0.5);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 6.2832);
      ctx.fill();
    }

    // selected member: bigger, ringed + filled in its contour colour
    if (sel < NENS) {
      const d = (ci[sel] - C_I) * P_DIR.i + (cj[sel] - C_J) * P_DIR.j;
      const x = xOf(d), y = yOf(field(ci[sel], cj[sel], P_I, P_J));
      if (x >= margin.l && x <= margin.l + pw && y >= margin.t && y <= margin.t + ph) {
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, 6.2832);
        ctx.lineWidth = 2;
        ctx.strokeStyle = memColor(sel);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 6.2832);
        ctx.fillStyle = memColor(sel);
        ctx.fill();
      }
    }

    // truth point
    ctx.fillStyle = T.ink1;
    ctx.beginPath(); ctx.arc(xOf(0), yOf(V_T), 4, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = T.surface1; ctx.lineWidth = 1.4;
    ctx.stroke();

    // reference line: displacement = 0, i.e. a member's centre sits exactly
    // on the truth centre — the origin of the projection axis shown in panel (a)
    // (the truth point dot below already marks it, so no extra label here)
    ctx.strokeStyle = hexA(T.ink3, 0.5);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xOf(0), margin.t); ctx.lineTo(xOf(0), margin.t + ph); ctx.stroke();
    ctx.setLineDash([]);

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
    for (const km of [-200, -100, 0, 100, 200, 300]) {
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
  const obsPosEl = $("pe-obs-pos");

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

  // select a member (highlights its ring in panel (a) and its dot in panel (c))
  function setSel(m) {
    sel = clamp(m, 0, NENS - 1);
    render();
  }

  // click on the (c) scatter to select the nearest member's dot
  cvC.addEventListener("click", (ev) => {
    const rect = cvC.getBoundingClientRect();
    const { margin, pw, ph, xOf, yOf } = cGeom(cvC.clientWidth, cvC.clientHeight);
    const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    if (cx < margin.l || cx > margin.l + pw || cy < margin.t || cy > margin.t + ph) return;
    let best = -1, bd = 20 * 20;           // click within 20 CSS px of a dot
    for (let m = 0; m < NENS; m++) {
      const d = (ci[m] - C_I) * P_DIR.i + (cj[m] - C_J) * P_DIR.j;
      const x = xOf(d), y = yOf(field(ci[m], cj[m], P_I, P_J));
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = m; }
    }
    if (best >= 0) setSel(best);
  });

  function render() {
    updateT();
    renderA(); renderB(); renderC();
  }

  sprdSlider.addEventListener("input", () => {
    Lsprd = parseFloat(sprdSlider.value) * SIG;   // slider is in units of sigma
    sprdVal.innerHTML = sprdSlider.value + " &sigma;";
    sampleEnsemble();
    render();
  });
  nensSlider.addEventListener("input", () => {
    NENS = parseInt(nensSlider.value, 10);
    nensVal.textContent = NENS;
    const lbl = $("pe-nens-label");
    if (lbl) lbl.textContent = NENS;
    ci = new Float64Array(NENS);
    cj = new Float64Array(NENS);
    sel = Math.min(sel, NENS - 1);
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
  const nensLbl = $("pe-nens-label");
  if (nensLbl) nensLbl.textContent = NENS;
  sampleEnsemble();
  render();

  const ro = new ResizeObserver(render);
  [cvA, cvB, cvC].forEach((cv) => ro.observe(cv));
})();
