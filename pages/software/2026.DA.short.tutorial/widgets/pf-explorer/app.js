/* Particle filter vs EnKF on the Rankine vortex — Ch. 6, section 2.
   Same toy model as the rankine widget (section 1): a modified Rankine
   vortex, ensemble members that differ ONLY in the centre position
   (centre = truth centre + N(0, L_sprd)), and one observation of the
   zonal wind u at the point P (the + on panel (a)).

   Three ensembles, all computed in-browser from the SAME prior particles:
   - prior:          centres drawn from the Gaussian location distribution.
   - EnKF posterior: the linear-regression update of the centres on the
                     innovation (y - u(P)): with one scalar observation the
                     gain is the sample covariance of centre vs u divided by
                     the sample variance of u plus R.  Affine in the
                     centres, so the posterior keeps the Gaussian shape of
                     the prior — and is biased when u(centre) is nonlinear.
   - PF posterior:   the SAME prior particles reweighted by the likelihood
                     p(y | centre) = N(y; u(centre), R).  Weighted dots on
                     the map (dot size = weight), weighted histograms in
                     panel (b), and an effective sample size readout.

   Panels:
   (a) map — truth rings, the three ensembles as centre dots, obs P.
   (b) histograms of u at P — prior, EnKF posterior, PF posterior
       (weighted), with the observed value ± σ_o and the truth.
   (c) mechanism — zonal wind u at P vs centre displacement toward P (the
       non-monotone map from section 1): the observation line crosses it at
       several displacements, so the likelihood is multimodal in position
       space; the PF posterior inherits that structure, the EnKF cannot.

   Controls: L_sprd (centre-position error, units of R_mw), N_ens (shared
   ensemble size), and the observed value y (m/s) — the third knob exposes
   the weight collapse: drag y away from the prior mass and watch N_eff
   fall while the EnKF posterior stays a broad Gaussian.

   Embedding-ready: root is the element with id="pf-explorer" (falls back
   to .da-widget / document root), theme follows prefers-color-scheme, and
   a ResizeObserver re-renders on reflow.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("pf-explorer") || document.querySelector(".da-widget") || document.documentElement;
  const cvA = $("pf-plot-a"), cvB = $("pf-plot-b"), cvC = $("pf-plot-c");
  const sprdSlider = $("pf-sprd"), sprdVal = $("pf-sprd-val");
  const nensSlider = $("pf-nens"), nensVal = $("pf-nens-val");
  const ySlider = $("pf-y"), yVal = $("pf-y-val");
  const rerunBtn = $("pf-rerun");

  /* ------------------------------------------------------------- model */
  const VMAX = 35, RMW = 5;            // m/s, grid points (same as rankine)
  const DX = 9.0;                      // km per grid point
  const C_I = 64, C_J = 64;            // truth centre (0.5 * 128)
  const P_ANG0 = 135 * Math.PI / 180;  // obs point: compass 135° = southeast
  const P_DIR0 = { i: Math.sin(P_ANG0), j: -Math.cos(P_ANG0) };
  const R0_0 = RMW + 0.2;              // slightly outside the radius of max wind
  const P_I = C_I + R0_0 * P_DIR0.i, P_J = C_J + R0_0 * P_DIR0.j;
  const SIG_O = 2.0;                   // observation error std, m/s (fixed)
  const NENS_MIN = 20, NENS_MAX = 400;

  let NENS = 100;                     // ensemble size (tunable)
  let Lsprd = RMW;                    // location spread, grid points (default 1 Rmw)
  let Y_OBS = 0;                      // observed u at P, m/s (set at init)

  // tangential wind speed of the modified Rankine vortex
  function vtheta(r) {
    r = Math.max(r, 1e-6);
    return r <= RMW ? VMAX * r / RMW : VMAX * Math.pow(RMW / r, 1.5);
  }
  // zonal wind u at (x, y) from a vortex centred at (ci, cj)
  function uWind(ci, cj, x, y) {
    const di = x - ci, dj = y - cj;
    const r = Math.hypot(di, dj) || 1e-6;
    return -vtheta(r) * dj / r;
  }
  const V_T = uWind(C_I, C_J, P_I, P_J);   // truth zonal wind at P
  // radii of the 20 m/s contour around a centre (analytic)
  function ringRadii() {
    return [20 * RMW / VMAX, RMW * Math.pow(VMAX / 20, 2 / 3)];
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

  /* ------------------------------------------------------------- theme */
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const T = {
    surface1: "#fcfcfb", ink1: "#0b0b0b", ink2: "#52514e", ink3: "#898781",
    line: "#e1e0d9", axis: "#c3c2b7", red: "#e34948", amber: "#eda100",
    blue: "#2b7bba", pf: "#2ca02c"
  };
  const updateT = () => {
    const kv = (n, f) => { const v = cssVar(n); if (v) f(v); };
    kv("--surface-1", v => T.surface1 = v); kv("--ink-1", v => T.ink1 = v);
    kv("--ink-2", v => T.ink2 = v); kv("--ink-3", v => T.ink3 = v);
    kv("--line", v => T.line = v); kv("--axis", v => T.axis = v);
    kv("--series-red", v => T.red = v); kv("--series-amber", v => T.amber = v);
    kv("--series-blue", v => T.blue = v); kv("--series-pf", v => T.pf = v);
  };
  updateT();

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

  /* ------------------------------------------- the three ensembles */
  // recomputed on every render (cheap up to 400 members)
  function compute() {
    const u = new Float64Array(NENS);
    let ubar = 0;
    for (let m = 0; m < NENS; m++) { u[m] = uWind(ci[m], cj[m], P_I, P_J); ubar += u[m]; }
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
    const ua = new Float64Array(NENS);
    for (let m = 0; m < NENS; m++) {
      ai[m] = ci[m] + KI * (Y_OBS - u[m]);
      aj[m] = cj[m] + KJ * (Y_OBS - u[m]);
      ua[m] = uWind(ai[m], aj[m], P_I, P_J);
    }
    let uaMean = 0, uaV2 = 0;
    for (let m = 0; m < NENS; m++) uaMean += ua[m];
    uaMean /= NENS;
    for (let m = 0; m < NENS; m++) { const d = ua[m] - uaMean; uaV2 += d * d; }
    const uaStd = Math.sqrt(uaV2 / NENS);

    // particle filter: likelihood weights
    const w = new Float64Array(NENS);
    let wsum = 0;
    for (let m = 0; m < NENS; m++) {
      const z = (Y_OBS - u[m]) / SIG_O;
      w[m] = Math.exp(-0.5 * z * z);
      wsum += w[m];
    }
    for (let m = 0; m < NENS; m++) w[m] /= wsum;
    let w2 = 0, wu = 0;
    for (let m = 0; m < NENS; m++) { w2 += w[m] * w[m]; wu += w[m] * u[m]; }
    const neff = 1 / w2;
    let wmax = 0;
    for (let m = 0; m < NENS; m++) if (w[m] > wmax) wmax = w[m];

    // prior statistics at P
    let v2 = 0, v3 = 0, v4 = 0;
    for (let m = 0; m < NENS; m++) {
      const d = u[m] - ubar;
      v2 += d * d; v3 += d * d * d; v4 += d * d * d * d;
    }
    const sd = Math.sqrt(v2 / NENS);
    const skew = (v3 / NENS) / Math.pow(sd, 3);
    const kurt = (v4 / NENS) / Math.pow(sd, 4) - 3;

    return { u, ubar, sd, skew, kurt, ai, aj, ua, uaMean, uaStd, w, wu, neff, wmax, KI, KJ };
  }

  /* ------------------------------------------------------- panel (a) */
  const WIN = 30;
  const TICKS_KM = [-270, -180, -90, 0, 90, 180, 270];

  function aGeom(W, H) {
    const margin = { l: 46, r: 12, t: 14, b: 32 };
    const pw = W - margin.l - margin.r;
    const ph = H - margin.t - margin.b;
    const side = Math.min(pw, ph);
    const x0 = margin.l + (pw - side) / 2;
    return { margin, side, x0, y0: margin.t, s: side / (2 * WIN) };
  }

  function renderA(c) {
    const [ctx, W, H] = sizeCanvas(cvA);
    const { margin, side, x0, y0, s } = aGeom(W, H);
    const [rIn, rOut] = ringRadii();

    // truth rings (thick)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(x0 + WIN * s, y0 + WIN * s, rIn * s, 0, 6.2832);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x0 + WIN * s, y0 + WIN * s, rOut * s, 0, 6.2832);
    ctx.stroke();

    // prior centres (blue)
    ctx.fillStyle = hexA(T.blue, 0.4);
    for (let m = 0; m < NENS; m++) {
      ctx.beginPath();
      ctx.arc(x0 + (ci[m] - (C_I - WIN)) * s, y0 + (cj[m] - (C_J - WIN)) * s, 2, 0, 6.2832);
      ctx.fill();
    }
    // EnKF analysis centres (red)
    ctx.fillStyle = hexA(T.red, 0.65);
    for (let m = 0; m < NENS; m++) {
      ctx.beginPath();
      ctx.arc(x0 + (c.ai[m] - (C_I - WIN)) * s, y0 + (c.aj[m] - (C_J - WIN)) * s, 2.1, 0, 6.2832);
      ctx.fill();
    }
    // PF posterior centres (green, dot size ∝ weight)
    for (let m = 0; m < NENS; m++) {
      const r = Math.min(7, 1.2 + 1.8 * (c.w[m] * NENS));
      ctx.fillStyle = hexA(T.pf, Math.min(1, 0.35 + 0.45 * (c.w[m] * NENS)));
      ctx.beginPath();
      ctx.arc(x0 + (ci[m] - (C_I - WIN)) * s, y0 + (cj[m] - (C_J - WIN)) * s, r, 0, 6.2832);
      ctx.fill();
    }

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

  /* ------------------------------------------------------- panel (b) */
  const U_LO = -40, U_HI = 40;         // u at P range (u ∈ [−35, 35] for any centre)
  const NB = 48;

  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / pow;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
  }

  function renderB(c) {
    const [ctx, W, H] = sizeCanvas(cvB);
    const margin = { l: 46, r: 12, t: 14, b: 30 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;
    const xOf = (v) => margin.l + (v - U_LO) / (U_HI - U_LO) * pw;
    const binW = (U_HI - U_LO) / NB;

    // KDE bandwidth (Silverman-ish), shared by all three curves
    const es = Array.from(c.u).sort((a, b) => a - b);
    const iqr = es[Math.floor(0.75 * NENS)] - es[Math.floor(0.25 * NENS)];
    const h = Math.max(0.5, 0.9 * Math.min(c.sd, iqr / 1.34) * Math.pow(NENS, -0.2));
    const k2p = Math.sqrt(2 * Math.PI);
    const NPTS = 240;
    const xs = new Array(NPTS + 1), fPrior = new Array(NPTS + 1), fEnKF = new Array(NPTS + 1), fPF = new Array(NPTS + 1);
    let fmax = 1;
    for (let i = 0; i <= NPTS; i++) {
      const x = U_LO + (U_HI - U_LO) * i / NPTS;
      xs[i] = x;
      let sP = 0, sE = 0, sW = 0;
      for (let m = 0; m < NENS; m++) {
        const z = (x - c.u[m]) / h;
        const k = Math.exp(-0.5 * z * z);
        sP += k;
        sE += Math.exp(-0.5 * ((x - c.ua[m]) / h) ** 2);
        sW += c.w[m] * k;
      }
      fPrior[i] = sP / (NENS * h * k2p);
      fEnKF[i] = sE / (NENS * h * k2p);
      fPF[i] = sW / (h * k2p);            // weighted: Σ w·K / h
      fmax = Math.max(fmax, fPrior[i], fEnKF[i], fPF[i]);
    }
    const cmax = fmax * binW * NENS;      // scale = equivalent bin counts

    // prior histogram bars (light blue)
    const counts = new Float64Array(NB);
    for (let m = 0; m < NENS; m++) {
      let b = Math.floor((c.u[m] - U_LO) / binW);
      if (b < 0) b = 0; if (b >= NB) b = NB - 1;
      counts[b]++;
    }
    for (let b = 0; b < NB; b++) {
      const bx = margin.l + b * binW / (U_HI - U_LO) * pw;
      const bw = Math.max(1, binW / (U_HI - U_LO) * pw - 1);
      const bh = (counts[b] / cmax) * ph * 0.72;
      ctx.fillStyle = hexA(T.blue, 0.18);
      ctx.fillRect(bx, margin.t + ph - bh, bw, bh);
    }
    const yOf = (f) => margin.t + ph - (f * binW * NENS) / cmax * ph * 0.72;
    const line = (arr, color, lw) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i <= NPTS; i++) {
        const x = xOf(xs[i]), y = yOf(arr[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    line(fPrior, T.blue, 1.7);
    line(fEnKF, T.red, 2);
    line(fPF, T.pf, 2.4);

    // observation y ± σ_o (amber band + line)
    ctx.fillStyle = hexA(T.amber, 0.14);
    ctx.fillRect(xOf(Y_OBS - SIG_O), margin.t, xOf(Y_OBS + SIG_O) - xOf(Y_OBS - SIG_O), ph);
    ctx.strokeStyle = T.amber;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(xOf(Y_OBS), margin.t);
    ctx.lineTo(xOf(Y_OBS), margin.t + ph);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const v of [Y_OBS - SIG_O, Y_OBS + SIG_O]) {
      ctx.beginPath();
      ctx.moveTo(xOf(v), margin.t + 4); ctx.lineTo(xOf(v), margin.t + ph - 4);
      ctx.stroke();
    }

    // truth u at P (ink)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 1.4;
    const tx = xOf(V_T);
    ctx.beginPath(); ctx.moveTo(tx, margin.t + 4); ctx.lineTo(tx, margin.t + ph); ctx.stroke();
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

    // axes
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
    ctx.strokeRect(margin.l, margin.t, pw, ph);
    ctx.fillStyle = T.ink3; ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const step = niceStep((U_HI - U_LO) / 5);
    const t0 = Math.ceil(U_LO / step) * step;
    for (let v = t0; v <= U_HI + 1e-9; v += step) {
      const xi = xOf(v);
      ctx.beginPath(); ctx.moveTo(xi, margin.t + ph); ctx.lineTo(xi, margin.t + ph + 4); ctx.stroke();
      ctx.fillText(String(Math.round(v * 10) / 10), xi, margin.t + ph + 6);
    }
    ctx.textAlign = "center";
    ctx.fillText("m/s", margin.l + pw / 2, margin.t + ph + 18);

    // readouts
    const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
    $("pf-prior-mean").textContent = f2(c.ubar);
    $("pf-prior-std").textContent = c.sd.toFixed(1);
    $("pf-prior-skew").textContent = f2(c.skew);
    const verdictEl = $("pf-prior-verdict");
    const zSkew = c.skew / Math.sqrt(6 / NENS);
    const zKurt = c.kurt / Math.sqrt(24 / NENS);
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
    $("pf-enkf-mean").textContent = f2(c.uaMean);
    $("pf-enkf-std").textContent = c.uaStd.toFixed(1);
    $("pf-pf-mean").textContent = f2(c.wu);
    $("pf-neff").textContent = c.neff.toFixed(0);
    const nn = $("pf-nens2"); if (nn) nn.textContent = NENS;
    $("pf-neff").style.color = (c.neff < 0.15 * NENS) ? T.red : T.ink1;
    $("pf-wmax").textContent = (c.wmax * 100).toFixed(1);
  }

  /* ------------------------------------------------------- panel (c) */
  const D_MIN = -20, D_MAX = 20;       // displacement range (grid points)

  function renderC(c) {
    const [ctx, W, H] = sizeCanvas(cvC);
    const margin = { l: 46, r: 12, t: 14, b: 32 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;
    const xOf = (d) => margin.l + (d - D_MIN) / (D_MAX - D_MIN) * pw;
    const yOf = (v) => margin.t + ph - (v - (-50)) / 100 * ph;   // v ∈ [−50, 50]

    // prior location pdf (Gaussian, std = Lsprd) as a shaded hump on the axis
    const pdf = (d) => Math.exp(-0.5 * Math.pow(d / Lsprd, 2)) / (Lsprd * Math.sqrt(2 * Math.PI));
    const pmax = pdf(0);
    const hump = 0.42 * ph;
    ctx.fillStyle = hexA(T.blue, 0.2);
    ctx.beginPath();
    ctx.moveTo(xOf(D_MIN), margin.t + ph);
    for (let i = 0; i <= 160; i++) {
      const d = D_MIN + (D_MAX - D_MIN) * i / 160;
      ctx.lineTo(xOf(d), margin.t + ph - hump * pdf(d) / pmax);
    }
    ctx.lineTo(xOf(D_MAX), margin.t + ph);
    ctx.closePath();
    ctx.fill();

    // the map: u at P vs centre displacement toward P (non-monotone)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const d = D_MIN + (D_MAX - D_MIN) * i / 300;
      const v = uWind(C_I + d * P_DIR0.i, C_J + d * P_DIR0.j, P_I, P_J);
      if (i === 0) ctx.moveTo(xOf(d), yOf(v));
      else ctx.lineTo(xOf(d), yOf(v));
    }
    ctx.stroke();

    // observation value y — amber line across the panel
    ctx.strokeStyle = hexA(T.amber, 0.85);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(margin.l, yOf(Y_OBS));
    ctx.lineTo(margin.l + pw, yOf(Y_OBS));
    ctx.stroke();
    // intersections u(d) = y
    ctx.fillStyle = T.amber;
    ctx.strokeStyle = T.surface1;
    ctx.lineWidth = 1.2;
    let prev = uWind(C_I + D_MIN * P_DIR0.i, C_J + D_MIN * P_DIR0.j, P_I, P_J) - Y_OBS;
    for (let i = 1; i <= 300; i++) {
      const d = D_MIN + (D_MAX - D_MIN) * i / 300;
      const v = uWind(C_I + d * P_DIR0.i, C_J + d * P_DIR0.j, P_I, P_J) - Y_OBS;
      if ((prev <= 0 && v > 0) || (prev >= 0 && v < 0)) {
        const dd = d - (D_MAX - D_MIN) / 300 * v / (v - prev);
        ctx.beginPath();
        ctx.arc(xOf(dd), yOf(Y_OBS), 4, 0, 6.2832);
        ctx.fill();
        ctx.stroke();
      }
      prev = v;
    }

    // the three ensembles: (centre displacement toward P, u at P)
    for (let m = 0; m < NENS; m++) {
      const dP = (ci[m] - C_I) * P_DIR0.i + (cj[m] - C_J) * P_DIR0.j;
      const dA = (c.ai[m] - C_I) * P_DIR0.i + (c.aj[m] - C_J) * P_DIR0.j;
      const xb = xOf(dP), yb = yOf(c.u[m]);
      if (xb >= margin.l && xb <= margin.l + pw && yb >= margin.t && yb <= margin.t + ph) {
        ctx.fillStyle = hexA(T.blue, 0.4);
        ctx.fillRect(xb - 1.2, yb - 1.2, 2.4, 2.4);
      }
      const xa = xOf(dA), ya = yOf(c.ua[m]);
      if (xa >= margin.l && xa <= margin.l + pw && ya >= margin.t && ya <= margin.t + ph) {
        ctx.fillStyle = hexA(T.red, 0.6);
        ctx.fillRect(xa - 1.2, ya - 1.2, 2.4, 2.4);
      }
      const rP = Math.min(6, 1 + 1.6 * (c.w[m] * NENS));
      ctx.fillStyle = hexA(T.pf, Math.min(1, 0.3 + 0.5 * (c.w[m] * NENS)));
      ctx.beginPath();
      ctx.arc(xb, yb, rP, 0, 6.2832);
      ctx.fill();
    }

    // truth point (centre on the truth: u = V_T)
    ctx.fillStyle = T.ink1;
    ctx.beginPath(); ctx.arc(xOf(0), yOf(V_T), 4, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = T.surface1; ctx.lineWidth = 1.4;
    ctx.stroke();

    // reference: the centre passes P (u reverses sign there)
    ctx.strokeStyle = hexA(T.ink3, 0.8);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xOf(R0_0), margin.t); ctx.lineTo(xOf(R0_0), margin.t + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = T.ink3;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("centre passes P", xOf(R0_0), margin.t + 2);

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
    ctx.fillText("km", margin.l + pw / 2, margin.t + ph + 18);
    ctx.save();
    ctx.translate(12, margin.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("zonal wind u at P (m/s)", 0, 0);
    ctx.restore();
  }

  /* ------------------------------------------------------------ glue */
  function render() { updateT(); const c = compute(); renderA(c); renderB(c); renderC(c); }

  sprdSlider.addEventListener("input", () => {
    Lsprd = parseFloat(sprdSlider.value) * RMW;   // slider is in units of Rmw
    sprdVal.innerHTML = sprdSlider.value + " R<sub>mw</sub>";
    sampleEnsemble();
    render();
  });
  nensSlider.addEventListener("input", () => {
    NENS = parseInt(nensSlider.value, 10);
    nensVal.textContent = NENS;
    ci = new Float64Array(NENS);
    cj = new Float64Array(NENS);
    sampleEnsemble();
    render();
  });
  ySlider.addEventListener("input", () => {
    Y_OBS = parseFloat(ySlider.value);
    yVal.textContent = Y_OBS.toFixed(1);
    render();
  });
  rerunBtn.addEventListener("click", () => { sampleEnsemble(); render(); });

  root.dataset.theme = theme;           // apply theme variables before the first render
  // defaults: Lsprd = 1 Rmw; y = truth + 3σ_o (an unlikely realization that
  // exposes the filters' differences)
  Y_OBS = V_T + 3 * SIG_O;
  sprdSlider.value = (Lsprd / RMW).toFixed(1);
  sprdVal.innerHTML = (Lsprd / RMW).toFixed(1) + " R<sub>mw</sub>";
  nensSlider.value = NENS;
  nensVal.textContent = NENS;
  ySlider.min = Math.min(-30, Math.floor((V_T - 25) / 0.5) * 0.5).toFixed(1);
  ySlider.max = Math.max(34, Math.ceil((V_T + 25) / 0.5) * 0.5).toFixed(1);
  ySlider.value = Y_OBS.toFixed(1);
  yVal.textContent = Y_OBS.toFixed(1);
  sampleEnsemble();
  render();

  const ro = new ResizeObserver(render);
  [cvA, cvB, cvC].forEach((cv) => ro.observe(cv));
})();
