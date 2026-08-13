/* Particle filter vs EnKF on the Gaussian hump — Ch. 6, section 2.
   Same toy model as the section-1 widget: the Chapter 2 warm blob
   (peak A = 8 K, width SIG = 15 grid points = 135 km), ensemble members
   that differ ONLY in the centre position (centre = truth centre +
   N(0, L_sprd)), and one observation of the temperature T at the point P
   (the + on every panel), sitting on the 4 K contour with observed value
   4 K and error σ_o = 1 K.

   The three panels are 4 K contour spaghetti plots of the SAME ensemble,
   before and after assimilating the observation, rendered exactly like
   the Ch. 2 explorer's first panel: the truth field as the YlOrRd
   shading, every member's 4 K contour extracted by marching squares
   (thin, coloured), the truth contour as a haloed dark ring, the
   highlighted member thick with its blob centre marked.  Every member
   keeps its own Tab20 colour in all three panels, so a member's rings
   can be traced from the prior, through the EnKF analysis, to the
   particle filter (the member slider highlights one member; the readout
   shows its weight):
   - (a) prior:      every member's 4 K contour.
   - (b) EnKF posterior: the linear-regression update of the centres on
                     the innovation (y - T(P)): with one scalar observation
                     the gain is the sample covariance of centre vs T over
                     the sample variance of T plus R.  Affine in the
                     centres, so the posterior keeps the Gaussian shape of
                     the prior — and is biased when T(centre) is nonlinear.
   - (c) PF posterior: the SAME prior particles reweighted by the
                     likelihood p(y | centre) = N(y; T(centre), R).  The
                     contours LIGHT UP with the weight: brightness and
                     line width ∝ weight, so only the members consistent
                     with the observation survive.

   Controls: L_sprd (centre-position error, units of the hump width SIG),
   N_ens (shared ensemble size), a "new ensemble" button, and a contours
   on/off toggle (left of the member slider).  The readout reports how
   far the centres are pulled toward the truth and how many particles
   effectively survive (N_eff = 1/Σ w²).

   Embedding-ready: root is the element with id="pf-explorer" (falls back
   to .da-widget / document root), theme follows prefers-color-scheme, and
   a ResizeObserver re-renders on reflow.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("pf-explorer") || document.querySelector(".da-widget") || document.documentElement;
  const cvPrior = $("pf-prior"), cvEnKF = $("pf-enkf"), cvPF = $("pf-pf");
  const sprdSlider = $("pf-sprd"), sprdVal = $("pf-sprd-val");
  const nensSlider = $("pf-nens"), nensVal = $("pf-nens-val");
  const rerunBtn = $("pf-rerun");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ------------------------------------------------------------- model */
  const A = 8, SIG = 15;               // hump peak (K), width (grid points = 135 km)
  const RING = 4;                      // K contour shown in the panels
  const DX = 9.0;                      // km per grid point
  const NX = 128, NY = 128;            // grid (0.5 * 128 = 64 = truth centre)
  const C_I = 64, C_J = 64;            // truth centre
  const P_ANG0 = 135 * Math.PI / 180;  // obs point: compass 135° = southeast
  const P_DIR0 = { i: Math.sin(P_ANG0), j: -Math.cos(P_ANG0) };
  const R0_0 = SIG * Math.sqrt(2 * Math.log(2));  // right on the 4 K contour
  const P_I = C_I + R0_0 * P_DIR0.i, P_J = C_J + R0_0 * P_DIR0.j;
  const SIG_O = 1.0;                   // observation error std, K (fixed)

  let NENS = 100;                     // ensemble size (tunable)
  let Lsprd = 1.5 * SIG;              // location spread, grid points (default 1.5 SIG)
  let sel = 49;                       // highlighted member, 0-based (default #50)
  let showContours = true;            // show all member contours in the spaghetti

  // temperature of the Gaussian hump at (x, y) from a centre at (ci, cj)
  function field(ci, cj, x, y) {
    const r2 = (x - ci) * (x - ci) + (y - cj) * (y - cj);
    return A * Math.exp(-r2 / (2 * SIG * SIG));
  }
  const V_T = field(C_I, C_J, P_I, P_J);          // truth temperature at P = 4 K
  const Y_OBS = 4.0;                              // observed T at P, K (on the 4 K contour)

  // member palette (Tab20-style cycle — the SAME member keeps its colour in
  // all three panels, so its contours can be traced prior → EnKF → PF)
  const MEM_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  const memColor = (m) => MEM_COLORS[m % MEM_COLORS.length];

  /* ------------------------------------------------------------- theme */
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const T = {
    surface1: "#fcfcfb", ink1: "#0b0b0b", ink3: "#898781", axis: "#c3c2b7",
    blue: "#2b7bba", red: "#e34948", pf: "#2ca02c"
  };
  const updateT = () => {
    const kv = (n, f) => { const v = cssVar(n); if (v) f(v); };
    kv("--surface-1", v => T.surface1 = v); kv("--ink-1", v => T.ink1 = v);
    kv("--ink-3", v => T.ink3 = v); kv("--axis", v => T.axis = v);
    kv("--series-blue", v => T.blue = v); kv("--series-red", v => T.red = v);
    kv("--series-pf", v => T.pf = v);
  };
  updateT();

  // ------------------------------------------- sequential truth LUT
  // YlOrRd in light mode, bright thermal in dark mode — the same shading
  // as the Ch. 2 explorer's truth panel
  const LUT_THERMAL = {
    light: [
      [0.000, "#ffffcc"], [0.125, "#ffeda0"], [0.250, "#fed976"], [0.375, "#feb24c"],
      [0.500, "#fd8d3c"], [0.625, "#fc4e2a"], [0.750, "#e31a1c"], [0.875, "#bd0026"],
      [1.000, "#800026"],
    ],
    dark: [
      [0.0, "#241439"], [0.18, "#4a1a7d"], [0.38, "#8d218f"], [0.55, "#d23570"],
      [0.72, "#f9702f"], [0.86, "#ffb94d"], [0.95, "#fff0a0"], [1.0, "#ffffff"],
    ],
  };
  function hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function makeLUT(stops) {
    const lut = new Array(256);
    for (let k = 0; k < 256; k++) {
      const v = k / 255;
      let s = 0;
      while (s < stops.length - 2 && v > stops[s + 1][0]) s++;
      const [v0, c0] = stops[s], [v1, c1] = stops[s + 1];
      const f = (v - v0) / (v1 - v0 || 1);
      const a = hex2rgb(c0), b = hex2rgb(c1);
      lut[k] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    return lut;
  }
  const lutTh = makeLUT(LUT_THERMAL.light);
  const vmax = Math.ceil(A);           // 8 K — the truth peak

  /* ------------------------------------------------ marching squares */
  // segments of the RING K contour of a flat field (value at j*NX+i), in
  // grid-point coordinates (same routine as the Ch. 2 explorer)
  function contourSegs(fld) {
    const segs = [];
    for (let j = 0; j < NY - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const v = [fld[j * NX + i] - RING, fld[j * NX + i + 1] - RING,
                   fld[(j + 1) * NX + i + 1] - RING, fld[(j + 1) * NX + i] - RING];
        let mask = 0;
        for (let k = 0; k < 4; k++) if (v[k] >= 0) mask |= 1 << k;
        if (mask === 0 || mask === 15) continue;
        const X = [i, i + 1, i + 1, i], Y = [j, j, j + 1, j + 1];
        const pt = (a, b) => {
          const t = v[a] / (v[a] - v[b]);
          return [X[a] + (X[b] - X[a]) * t, Y[a] + (Y[b] - Y[a]) * t];
        };
        const cr = [
          (v[0] < 0) !== (v[1] < 0), (v[1] < 0) !== (v[2] < 0),
          (v[2] < 0) !== (v[3] < 0), (v[3] < 0) !== (v[0] < 0),
        ];
        const ncross = cr[0] + cr[1] + cr[2] + cr[3];
        if (ncross === 2) {
          const a = cr.indexOf(true), b = cr.indexOf(true, a + 1);
          const p = pt(a, (a + 1) % 4), q = pt(b, (b + 1) % 4);
          segs.push([p[0], p[1], q[0], q[1]]);
        } else if (ncross === 4) {
          // saddle cell: connect both diagonal pairs
          let p = pt(0, 1), q = pt(2, 3);
          segs.push([p[0], p[1], q[0], q[1]]);
          p = pt(1, 2); q = pt(3, 0);
          segs.push([p[0], p[1], q[0], q[1]]);
        }
      }
    }
    return segs;
  }

  // truth field: 2-D (for the shading) + flat (for the contour)
  const truthFlat = new Float64Array(NX * NY);
  const truth2D = new Array(NY);
  for (let j = 0; j < NY; j++) {
    const row = new Float64Array(NX);
    for (let i = 0; i < NX; i++) {
      const v = field(C_I, C_J, i, j);
      row[i] = v; truthFlat[j * NX + i] = v;
    }
    truth2D[j] = row;
  }
  const truthSegs = contourSegs(truthFlat);

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

  // 2-D field shading, same as the Ch. 2 truth panel (cropped to the map
  // window around the truth centre)
  function drawField(ctx, field2d) {
    const off = document.createElement("canvas");
    off.width = NX; off.height = NY;
    const octx = off.getContext("2d");
    const img = octx.createImageData(NX, NY);
    const data = img.data;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const t = clamp(field2d[j][i] / vmax, 0, 1);
        const c = lutTh[Math.round(t * 255)];
        const p = (j * NX + i) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // crop to the 2*WIN window around the truth centre, stretch to the map square
    ctx.drawImage(off, C_I - WIN, C_J - WIN, 2 * WIN, 2 * WIN, x0c, y0c, sidec, sidec);
  }

  /* ------------------------------------------------------- spaghetti */
  const WIN = 30;                       // half-window in grid points (±270 km) —
  // the same extent as the section-1 widget: ticks in km from −270 to 270
  const TICKS_KM = [-270, -180, -90, 0, 90, 180, 270];
  let x0c = 0, y0c = 0, sidec = 1;      // current map square (for drawField)

  function aGeom(W, H) {
    const margin = { l: 46, r: 12, t: 14, b: 32 };
    const pw = W - margin.l - margin.r;
    const ph = H - margin.t - margin.b;
    const side = Math.min(pw, ph);
    const x0 = margin.l + (pw - side) / 2;
    return { margin, side, x0, y0: margin.t, s: side / (2 * WIN) };
  }

  // contour segments in grid coords -> canvas, within the map square
  function drawSegs(ctx, segs, color, lw, alpha, x0, y0, s) {
    if (!segs.length) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let k = 0; k < segs.length; k++) {
      const g = segs[k];
      ctx.moveTo(x0 + (g[0] - (C_I - WIN)) * s, y0 + (g[1] - (C_J - WIN)) * s);
      ctx.lineTo(x0 + (g[2] - (C_I - WIN)) * s, y0 + (g[3] - (C_J - WIN)) * s);
    }
    ctx.stroke();
    ctx.restore();
  }

  // one spaghetti panel — rendered exactly like the Ch. 2 first panel:
  // truth-field shading, every member's contour (styled per member), the
  // highlighted member + blob centre, the haloed truth contour, P, axes.
  // styleFn(m) -> { color, alpha, lw } (return null to skip).
  function drawEnsembleMap(cv, segs, centres, styleFn) {
    const [ctx, W, H] = sizeCanvas(cv);
    const { margin, side, x0, y0, s } = aGeom(W, H);
    x0c = x0; y0c = y0; sidec = side;

    drawField(ctx, truth2D);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, side, side);
    ctx.clip();
    if (showContours) {
      for (let m = 0; m < NENS; m++) {
        if (m === sel) continue;
        const st = styleFn(m);
        if (!st || st.alpha <= 0.01) continue;
        drawSegs(ctx, segs[m], st.color, st.lw, st.alpha, x0, y0, s);
      }
    }
    // highlighted member: thick, full opacity + blob centre dot
    drawSegs(ctx, segs[sel], memColor(sel), 2.4, 1, x0, y0, s);
    {
      const cxm = x0 + (centres.ci[sel] - (C_I - WIN)) * s;
      const cym = y0 + (centres.cj[sel] - (C_J - WIN)) * s;
      ctx.beginPath();
      ctx.arc(cxm, cym, 4.5, 0, 6.2832);
      ctx.fillStyle = cssVar("--accent-fill");
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = memColor(sel);
      ctx.stroke();
    }
    // truth contour: halo + ink core so it reads on every colour
    drawSegs(ctx, truthSegs, theme === "dark" ? "#241439" : "#ffffff", 3.4, 0.95, x0, y0, s);
    drawSegs(ctx, truthSegs, T.ink1, 1.6, 1, x0, y0, s);
    ctx.restore();

    // observation point P — white cross with a dark halo
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
    ctx.textBaseline = "middle";
    for (const km of TICKS_KM) {
      const yi = y0 + (km / DX + WIN) * s;
      ctx.beginPath();
      ctx.moveTo(x0, yi); ctx.lineTo(x0 - 4, yi);
      ctx.stroke();
      ctx.fillText(String(km), x0 - 6, yi);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("km", x0 + side / 2, y0 + side + 18);
  }

  function drawColorbar(cv) {
    const [ctx, W, H] = sizeCanvas(cv);
    for (let k = 0; k < W; k++) {
      const c = lutTh[Math.max(0, Math.min(255, Math.round((k / (W - 1)) * 255)))];
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(k, 0, 1, H);
    }
    const lbl = cv.parentElement.querySelector(".cb-labels");
    if (lbl) {
      const f = (x) => (Math.abs(x) < 1e-9 ? "0" : x.toFixed(0)) + " K";
      lbl.querySelector(".cb-min").textContent = f(0);
      lbl.querySelector(".cb-mid").textContent = f(vmax / 2);
      lbl.querySelector(".cb-max").textContent = f(vmax);
    }
  }

  /* ------------------------------------------------- the two analyses */
  function compute() {
    const u = new Float64Array(NENS);
    let ubar = 0;
    for (let m = 0; m < NENS; m++) { u[m] = field(ci[m], cj[m], P_I, P_J); ubar += u[m]; }
    ubar /= NENS;
    let cIbar = 0, cJbar = 0;
    for (let m = 0; m < NENS; m++) { cIbar += ci[m]; cJbar += cj[m]; }
    cIbar /= NENS; cJbar /= NENS;

    // EnKF: linear regression of the centres on the innovation
    let varU = 0, covI = 0, covJ = 0;
    for (let m = 0; m < NENS; m++) {
      const du = u[m] - ubar, di = ci[m] - cIbar, dj = cj[m] - cJbar;
      varU += du * du; covI += di * du; covJ += dj * du;
    }
    const n1 = NENS - 1, R = SIG_O * SIG_O;
    varU /= n1; covI /= n1; covJ /= n1;
    const KI = covI / (varU + R), KJ = covJ / (varU + R);
    const ai = new Float64Array(NENS), aj = new Float64Array(NENS);
    for (let m = 0; m < NENS; m++) {
      ai[m] = ci[m] + KI * (Y_OBS - u[m]);
      aj[m] = cj[m] + KJ * (Y_OBS - u[m]);
    }

    // particle filter: likelihood weights
    const w = new Float64Array(NENS);
    let wsum = 0;
    for (let m = 0; m < NENS; m++) {
      const z = (Y_OBS - u[m]) / SIG_O;
      w[m] = Math.exp(-0.5 * z * z);
      wsum += w[m];
    }
    for (let m = 0; m < NENS; m++) w[m] /= wsum;
    let w2 = 0, wmax = 0;
    for (let m = 0; m < NENS; m++) {
      w2 += w[m] * w[m];
      if (w[m] > wmax) wmax = w[m];
    }
    const neff = 1 / w2;

    // how far each ensemble's centres sit from the truth centre (rms, grid pts)
    let rmsP = 0, rmsE = 0, rmsW = 0;
    for (let m = 0; m < NENS; m++) {
      const dp = Math.hypot(ci[m] - C_I, cj[m] - C_J);
      const de = Math.hypot(ai[m] - C_I, aj[m] - C_J);
      rmsP += dp * dp; rmsE += de * de; rmsW += w[m] * dp * dp;
    }
    rmsP = Math.sqrt(rmsP / NENS);
    rmsE = Math.sqrt(rmsE / NENS);
    rmsW = Math.sqrt(rmsW);

    return { u, ai, aj, w, neff, wmax, rmsP, rmsE, rmsW };
  }

  // ---- precompute the prior's and the EnKF analysis's member contours
  // (marching squares on each member's field — recomputed on resample)
  let priorSegs = new Array(NENS), enkfSegs = new Array(NENS);
  const mf = new Float64Array(NX * NY);
  function memberField(cx, cy) {
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const r2 = (i - cx) * (i - cx) + (j - cy) * (j - cy);
        mf[j * NX + i] = A * Math.exp(-r2 / (2 * SIG * SIG));
      }
    }
  }
  function buildContours() {
    const c = compute();
    priorSegs = new Array(NENS);
    enkfSegs = new Array(NENS);
    for (let m = 0; m < NENS; m++) {
      memberField(ci[m], cj[m]);
      priorSegs[m] = contourSegs(mf);
      memberField(c.ai[m], c.aj[m]);
      enkfSegs[m] = contourSegs(mf);
    }
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

  let ci = new Float64Array(NENS), cj = new Float64Array(NENS);
  function sampleEnsemble() {
    for (let m = 0; m < NENS; m++) {
      ci[m] = C_I + gauss() * Lsprd;
      cj[m] = C_J + gauss() * Lsprd;
    }
  }

  /* ------------------------------------------------------------ glue */
  function render() {
    updateT();
    const th2 = makeLUT(LUT_THERMAL[theme]);
    lutTh.splice(0, lutTh.length, ...th2);
    const c = compute();

    // panel (a): prior — every member coloured, equally dim
    drawEnsembleMap(cvPrior, priorSegs, { ci, cj }, (m) => ({ color: memColor(m), alpha: 0.42, lw: 1 }));

    // panel (b): EnKF analysis
    drawEnsembleMap(cvEnKF, enkfSegs, { ci: c.ai, cj: c.aj }, (m) => ({ color: memColor(m), alpha: 0.55, lw: 1 }));

    // panel (c): PF posterior — brightness AND width ∝ weight ("light up")
    drawEnsembleMap(cvPF, priorSegs, { ci, cj }, (m) => ({
      color: memColor(m),
      alpha: 0.08 + 0.92 * (c.w[m] / c.wmax),
      lw: 1 + 1.7 * (c.w[m] / c.wmax),
    }));

    drawColorbar($("cb-prior"));
    drawColorbar($("cb-enkf"));
    drawColorbar($("cb-pf"));

    // readout
    const km = (g) => (g * DX).toFixed(0);
    const wsel = c.w[sel] * 100;
    const wTxt = wsel < 0.05 ? "\u22480%" : wsel.toFixed(1) + "%";
    $("pf-readout").innerHTML =
      `obs T(P) = <strong>${Y_OBS.toFixed(1)} K</strong> (&sigma;<sub>o</sub> = ${SIG_O.toFixed(1)}) ` +
      `&#183; centre distance from truth (rms): prior <strong>${km(c.rmsP)} km</strong> ` +
      `&rarr; EnKF <strong>${km(c.rmsE)} km</strong> &#183; PF (weighted) <strong>${km(c.rmsW)} km</strong> ` +
      `&#183; N<sub>eff</sub> = <strong>${c.neff.toFixed(0)}</strong> of ${NENS} ` +
      `&#183; member <strong>${sel + 1}</strong> w <strong>${wTxt}</strong> (max <strong>${(c.wmax * 100).toFixed(1)}%</strong>)`;
  }

  function resample() {
    sampleEnsemble();
    buildContours();
    render();
  }

  sprdSlider.addEventListener("input", () => {
    Lsprd = parseFloat(sprdSlider.value) * SIG;   // slider is in units of sigma
    sprdVal.innerHTML = sprdSlider.value + " &sigma;";
    resample();
  });
  nensSlider.addEventListener("input", () => {
    NENS = parseInt(nensSlider.value, 10);
    nensVal.textContent = NENS;
    ci = new Float64Array(NENS);
    cj = new Float64Array(NENS);
    sel = Math.min(sel, NENS - 1);
    selSlider.max = NENS;
    selSlider.value = sel + 1;
    selVal.textContent = sel + 1;
    resample();
  });
  const selSlider = $("pf-sel"), selVal = $("pf-sel-val");
  selSlider.addEventListener("input", () => {
    sel = clamp(parseInt(selSlider.value, 10) || 1, 1, NENS) - 1;
    selVal.textContent = sel + 1;
    render();
  });
  rerunBtn.addEventListener("click", resample);
  const contoursBtn = $("pf-contours");
  if (contoursBtn) {
    contoursBtn.addEventListener("click", () => {
      showContours = !showContours;
      contoursBtn.textContent = showContours ? "Contours: on" : "Contours: off";
      contoursBtn.setAttribute("aria-pressed", String(showContours));
      render();
    });
  }

  root.dataset.theme = theme;           // apply theme variables before the first render
  sprdSlider.value = (Lsprd / SIG).toFixed(1);   // put the slider head back at the default (1.5 sigma)
  sprdVal.innerHTML = (Lsprd / SIG).toFixed(1) + " &sigma;";
  nensSlider.value = NENS;
  nensVal.textContent = NENS;
  selSlider.max = NENS;
  selSlider.value = sel + 1;
  selVal.textContent = sel + 1;
  sampleEnsemble();
  buildContours();
  render();

  const ro = new ResizeObserver(render);
  [cvPrior, cvEnKF, cvPF].forEach((cv) => ro.observe(cv));
})();
