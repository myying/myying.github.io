/* Particle filter vs EnKF on the Gaussian hump — Ch. 6, section 2.
   Same toy model as the section-1 widget: the Chapter 2 warm blob
   (peak A = 8 K, radius scale SIG = blob_sig = 0.1 * domain width = 5 grid
   points = 50 km, Ch. 2's actual generate_data.py parameter), ensemble members
   that differ ONLY in the centre position (centre = truth centre +
   N(0, L_sprd)), and one observation of the temperature T at the point P
   (the + on every panel) — the same grid offset from the truth centre as
   Ch. 2's own observation from its blob peak (not on the 4 K contour), with
   observed value 4 K and error σ_o (tunable, default 1 K).

   The three panels are 4 K contour spaghetti plots of the SAME ensemble,
   before and after assimilating the observation, rendered like the Ch. 2
   explorer's first panel: every member's 4 K contour extracted by marching
   squares (thin, coloured), the truth contour as a haloed dark ring. Every
   member keeps its own Tab20 colour in all three panels, so a member's
   rings can be traced from the prior, through the EnKF analysis, to the
   particle filter:
   - (a) prior:      shading is the PRIOR ensemble MEAN field (same
                     convention as the Ch. 3 background panel — position
                     uncertainty averages out the blob, so the mean is
                     broader and weaker than the truth ring).
   - (b) EnKF posterior: shading is the EnKF-ANALYSIS ensemble mean field,
                     on the SAME colour scale as (a) so the two are directly
                     comparable (Ch. 3 convention again).  The analysis uses
                     the EXACT SAME per-grid-cell stochastic EnKF formula as
                     the Ch. 3 widget — xa_m = xb_m + K (y + eps_m - H xb_m),
                     K = cov(field, T(P)) / (var(T(P)) + R), applied
                     independently at every grid cell — NOT a shortcut that
                     regresses the members' centre position and re-draws a
                     clean Gaussian there.  Because the true state here is a
                     rigid translation (a 2-parameter family) but the EnKF
                     update is a per-cell linear combination, the posterior
                     can't reproduce a clean shift: it distorts the blob
                     (the classic position-error dipole bias) rather than
                     sliding it — that distortion, not a moved blob, is the
                     actual EnKF failure mode this section is about.
   - (c) PF posterior: the SAME prior particles reweighted by the
                     likelihood p(y | centre) = N(y; T(centre), R).  The
                     contours LIGHT UP with the weight: brightness and
                     line width ∝ weight, so only the members consistent
                     with the observation survive; shading is the WEIGHTED
                     mean field (Σ w_m · field_m, same colour scale as (a)
                     and (b)) — near-zero-weight ("dropped") particles
                     contribute essentially nothing to it, so it visibly
                     concentrates on wherever the surviving high-weight
                     members sit (see the readout's N_eff for how many
                     particles effectively remain).

   Controls: L_sprd (centre-position error, units of the hump width SIG),
   N_ens (shared ensemble size), σ_o (observation error std, drives both the
   EnKF gain and the PF likelihood weights), a "new ensemble" button, and a
   contours on/off toggle.  The readout reports how far the centres are
   pulled toward the truth and how many particles effectively survive
   (N_eff = 1/Σ w²).

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
  const sigOSlider = $("pf-sigo"), sigOVal = $("pf-sigo-val");
  const rerunBtn = $("pf-rerun");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ------------------------------------------------------------- model */
  const A = 8, SIG = 5;                 // hump peak (K), radius scale (grid points = 50 km, Ch. 2's own scale)
  const RING = 4;                      // K contour shown in the panels
  const DX = 10.0;                      // km per grid point (the Ch. 2 setting)
  const NX = 128, NY = 128;            // grid (0.5 * 128 = 64 = truth centre)
  const C_I = 64, C_J = 64;            // truth centre
  // obs point: the exact same grid offset as Ch. 2's own observation from its
  // blob peak (obs (28,22) minus peak (24,24) = +4,-2 grid cells; both grids
  // use dx = 10 km, so the offset carries over directly) — same as the
  // section-1 widget. Not on the 4 K contour (Ch. 2's own obs isn't either).
  const P_I = C_I + 4, P_J = C_J - 2;
  let SIG_O = 1.0;                     // observation error std, K (tunable)

  let NENS = 100;                     // ensemble size (tunable)
  let Lsprd = 1.5 * SIG;              // location spread, grid points (default 1.5 SIG)
  let showContours = true;            // show all member contours in the spaghetti

  // temperature of the Gaussian hump at (x, y) from a centre at (ci, cj)
  function field(ci, cj, x, y) {
    const r2 = (x - ci) * (x - ci) + (y - cj) * (y - cj);
    return A * Math.exp(-r2 / (2 * SIG * SIG));
  }
  const V_T = field(C_I, C_J, P_I, P_J);          // truth temperature at P (not 4 K: P isn't on the 4 K contour)
  const Y_OBS = 4.0;                              // observed T at P, K (differs from V_T — obs error)

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

  // 2-D field shading, same technique as the Ch. 2 truth panel (cropped to
  // the map window around the truth centre); hi is the panel's own colour
  // scale (0..hi), so the prior/EnKF mean shading and the PF truth shading
  // can each use an appropriate range
  function drawField(ctx, field2d, hi) {
    const off = document.createElement("canvas");
    off.width = NX; off.height = NY;
    const octx = off.getContext("2d");
    const img = octx.createImageData(NX, NY);
    const data = img.data;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const t = clamp(field2d[j][i] / hi, 0, 1);
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
  const WIN = 25;                       // half-window in grid points — ±250 km at
  // dx = 10 km, the same 500 x 500 km domain as Ch. 2 and the section-1 widget
  const TICKS_KM = [-200, -100, 0, 100, 200];
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

  // one spaghetti panel — rendered like the Ch. 2 first panel / the Ch. 3
  // background-analysis panels: field shading (field2d, on scale 0..hi),
  // every member's contour (styled per member), the haloed truth contour,
  // P, axes.
  // styleFn(m) -> { color, alpha, lw } (return null to skip).
  function drawEnsembleMap(cv, segs, styleFn, field2d, hi) {
    const [ctx, W, H] = sizeCanvas(cv);
    const { margin, side, x0, y0, s } = aGeom(W, H);
    x0c = x0; y0c = y0; sidec = side;

    drawField(ctx, field2d, hi);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, side, side);
    ctx.clip();
    if (showContours) {
      for (let m = 0; m < NENS; m++) {
        const st = styleFn(m);
        if (!st || st.alpha <= 0.01) continue;
        drawSegs(ctx, segs[m], st.color, st.lw, st.alpha, x0, y0, s);
      }
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

  function drawColorbar(cv, hi) {
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
      lbl.querySelector(".cb-mid").textContent = f(hi / 2);
      lbl.querySelector(".cb-max").textContent = f(hi);
    }
  }

  /* --------------------------------------------------- particle weights */
  // T(P) per member + particle-filter likelihood weights (unaffected by
  // the EnKF change below — the PF reweights the SAME prior particles)
  function computeWeights() {
    const u = new Float64Array(NENS);
    for (let m = 0; m < NENS; m++) u[m] = field(ci[m], cj[m], P_I, P_J);
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
    let rmsP = 0, rmsW = 0;
    for (let m = 0; m < NENS; m++) {
      const dp2 = (ci[m] - C_I) * (ci[m] - C_I) + (cj[m] - C_J) * (cj[m] - C_J);
      rmsP += dp2; rmsW += w[m] * dp2;
    }
    rmsP = Math.sqrt(rmsP / NENS);
    rmsW = Math.sqrt(rmsW);
    return { u, w, neff, wmax, rmsP, rmsW };
  }

  // ---- precompute the prior's and the EnKF analysis's member contours
  // (marching squares — recomputed on resample), plus the three
  // ensemble-MEAN fields used for the panel shading (Ch. 3 convention: mean
  // field + member contours + truth ring). The EnKF analysis is the SAME
  // per-grid-cell stochastic formula as the Ch. 3 widget (perturbed obs):
  //   xa_m[cell] = xb_m[cell] + K[cell] (y + eps_m - H xb_m),
  //   K[cell] = cov(field[cell], H xb) / (var(H xb) + R)
  // applied independently at every cell — it does NOT move the members'
  // centres, so the analysis fields are in general no longer clean Gaussian
  // humps (see the header comment). The PF panel's "mean" is the WEIGHTED
  // mean (Σ w_m · field_m) of the (unmoved) prior fields: dead
  // (near-zero-weight) particles contribute essentially nothing to it, so
  // it visibly concentrates around wherever the surviving members sit.
  let priorSegs = new Array(NENS), enkfSegs = new Array(NENS);
  let priorMean2D = truth2D, enkfMean2D = truth2D, pfMean2D = truth2D;   // placeholders until the first buildContours()
  let priorMeanHi = vmax, enkfMeanHi = vmax, pfMeanHi = vmax;
  let stats = null;   // last computeWeights() + rmsE, cached for render()'s readout
  const mf = new Float64Array(NX * NY), af = new Float64Array(NX * NY);
  const priorSum = new Float64Array(NX * NY), enkfSum = new Float64Array(NX * NY), pfSum = new Float64Array(NX * NY);
  const meanF = new Float64Array(NX * NY), covF = new Float64Array(NX * NY);
  function memberField(cx, cy) {
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const r2 = (i - cx) * (i - cx) + (j - cy) * (j - cy);
        mf[j * NX + i] = A * Math.exp(-r2 / (2 * SIG * SIG));
      }
    }
  }
  function to2D(flat) {
    const out = new Array(NY);
    for (let j = 0; j < NY; j++) {
      const row = new Float64Array(NX);
      for (let i = 0; i < NX; i++) row[i] = flat[j * NX + i];
      out[j] = row;
    }
    return out;
  }
  function buildContours() {
    const wc = computeWeights();
    const hxb = wc.u;
    let hxbMean = 0;
    for (let m = 0; m < NENS; m++) hxbMean += hxb[m];
    hxbMean /= NENS;
    let varB = 0;
    for (let m = 0; m < NENS; m++) { const d = hxb[m] - hxbMean; varB += d * d; }
    varB /= (NENS - 1);

    // pass 1: prior member fields + contours, prior mean field, PF weighted mean
    priorSegs = new Array(NENS);
    priorSum.fill(0);
    pfSum.fill(0);
    for (let m = 0; m < NENS; m++) {
      memberField(ci[m], cj[m]);
      priorSegs[m] = contourSegs(mf);
      for (let p = 0; p < NX * NY; p++) { priorSum[p] += mf[p]; pfSum[p] += wc.w[m] * mf[p]; }
    }
    for (let p = 0; p < NX * NY; p++) meanF[p] = priorSum[p] / NENS;

    // pass 2: per-cell covariance of the prior field with H xb = T(P) —
    // P_bHᵀ, the same quantity the Ch. 3 widget calls covF
    covF.fill(0);
    for (let m = 0; m < NENS; m++) {
      memberField(ci[m], cj[m]);
      const dHxb = hxb[m] - hxbMean;
      for (let p = 0; p < NX * NY; p++) covF[p] += (mf[p] - meanF[p]) * dHxb;
    }
    const R = SIG_O * SIG_O, denom = varB + R;
    for (let p = 0; p < NX * NY; p++) covF[p] /= (NENS - 1);

    // pass 3: per-member analysis field xa_m = xb_m + K (y + eps_m - Hxb_m),
    // its contour, its contribution to the analysis mean, and its contour
    // centroid (for the rms centre-distance readout — the analysis field
    // has no explicit "centre" parameter any more)
    enkfSegs = new Array(NENS);
    enkfSum.fill(0);
    let rmsE = 0;
    const sqrtR = Math.sqrt(R);
    for (let m = 0; m < NENS; m++) {
      memberField(ci[m], cj[m]);
      const inc = Y_OBS + obsZ[m] * sqrtR - hxb[m];
      for (let p = 0; p < NX * NY; p++) { af[p] = mf[p] + covF[p] / denom * inc; enkfSum[p] += af[p]; }
      const segs = contourSegs(af);
      enkfSegs[m] = segs;
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < segs.length; k++) { sx += segs[k][0] + segs[k][2]; sy += segs[k][1] + segs[k][3]; n += 2; }
      const cxm = n ? sx / n : ci[m], cym = n ? sy / n : cj[m];
      rmsE += (cxm - C_I) * (cxm - C_I) + (cym - C_J) * (cym - C_J);
    }
    rmsE = Math.sqrt(rmsE / NENS);
    stats = { w: wc.w, neff: wc.neff, wmax: wc.wmax, rmsP: wc.rmsP, rmsW: wc.rmsW, rmsE };

    for (let p = 0; p < NX * NY; p++) enkfSum[p] /= NENS;   // pfSum is already a weighted average (weights sum to 1)
    priorMean2D = to2D(meanF);
    enkfMean2D = to2D(enkfSum);
    pfMean2D = to2D(pfSum);
    // fixed 0..8 K scale (the truth peak) across all three panels, so the
    // mean fields stay directly comparable (same convention as the Ch. 3
    // background/analysis panels) and the colourbar never rescales
    priorMeanHi = enkfMeanHi = pfMeanHi = vmax;
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
  let obsZ = new Float64Array(NENS);   // perturbed-obs unit normals (Ch. 3's stochastic EnKF)
  function sampleEnsemble() {
    for (let m = 0; m < NENS; m++) {
      ci[m] = C_I + gauss() * Lsprd;
      cj[m] = C_J + gauss() * Lsprd;
      obsZ[m] = gauss();
    }
  }

  /* ------------------------------------------------------------ glue */
  function render() {
    updateT();
    const th2 = makeLUT(LUT_THERMAL[theme]);
    lutTh.splice(0, lutTh.length, ...th2);
    const c = stats;   // cached by the last buildContours() — doesn't change between renders

    // panel (a): prior — every member coloured, equally dim; shading = prior mean
    drawEnsembleMap(cvPrior, priorSegs, (m) => ({ color: memColor(m), alpha: 0.42, lw: 1 }),
      priorMean2D, priorMeanHi);

    // panel (b): EnKF analysis; shading = analysis mean, same scale as (a)
    drawEnsembleMap(cvEnKF, enkfSegs, (m) => ({ color: memColor(m), alpha: 0.55, lw: 1 }),
      enkfMean2D, enkfMeanHi);

    // panel (c): PF posterior — brightness AND width ∝ weight ("light up");
    // shading is the weighted mean of the (unmoved) prior fields
    drawEnsembleMap(cvPF, priorSegs, (m) => ({
      color: memColor(m),
      alpha: 0.08 + 0.92 * (c.w[m] / c.wmax),
      lw: 1 + 1.7 * (c.w[m] / c.wmax),
    }), pfMean2D, pfMeanHi);

    drawColorbar($("cb-prior"), priorMeanHi);
    drawColorbar($("cb-enkf"), enkfMeanHi);
    drawColorbar($("cb-pf"), pfMeanHi);

    // readout
    const km = (g) => (g * DX).toFixed(0);
    $("pf-readout").innerHTML =
      `obs T(P) = <strong>${Y_OBS.toFixed(1)} K</strong> (&sigma;<sub>o</sub> = ${SIG_O.toFixed(1)}) ` +
      `&#183; centre distance from truth (rms): prior <strong>${km(c.rmsP)} km</strong> ` +
      `&rarr; EnKF <strong>${km(c.rmsE)} km</strong> &#183; PF (weighted) <strong>${km(c.rmsW)} km</strong> ` +
      `&#183; N<sub>eff</sub> = <strong>${c.neff.toFixed(0)}</strong> of ${NENS} ` +
      `&#183; max particle weight <strong>${(c.wmax * 100).toFixed(1)}%</strong>`;
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
    obsZ = new Float64Array(NENS);
    resample();
  });
  if (sigOSlider) {
    sigOSlider.addEventListener("input", () => {
      SIG_O = clamp(parseFloat(sigOSlider.value) || 1, 0.2, 4);
      sigOVal.textContent = SIG_O.toFixed(2);
      buildContours();   // EnKF gain and PF weights both depend on SIG_O
      render();
    });
  }
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
  if (sigOSlider) { sigOSlider.value = SIG_O; sigOVal.textContent = SIG_O.toFixed(2); }
  sampleEnsemble();
  buildContours();
  render();

  const ro = new ResizeObserver(render);
  [cvPrior, cvEnKF, cvPF].forEach((cv) => ro.observe(cv));
})();
