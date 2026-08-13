/* Particle filter vs EnKF on the Rankine vortex — Ch. 6, section 2.
   Same toy model as the rankine widget (section 1): a modified Rankine
   vortex, ensemble members that differ ONLY in the centre position
   (centre = truth centre + N(0, L_sprd)), and one observation of the
   zonal wind u at the point P (the + on every panel).

   The three panels are 20 m/s wind-contour spaghetti plots of the SAME
   ensemble, before and after assimilating the observation.  Every member
   keeps its own Tab20 colour in all three panels, so a member's rings can
   be traced from the prior, through the EnKF analysis, to the particle
   filter (the member slider highlights one member; the readout shows its
   weight):
   - (a) prior:      every member's 20 m/s rings around its centre.
   - (b) EnKF posterior: the linear-regression update of the centres on
                     the innovation (y - u(P)): with one scalar observation
                     the gain is the sample covariance of centre vs u over
                     the sample variance of u plus R.  Affine in the
                     centres, so the posterior keeps the Gaussian shape of
                     the prior — and is biased when u(centre) is nonlinear.
   - (c) PF posterior: the SAME prior particles reweighted by the
                     likelihood p(y | centre) = N(y; u(centre), R).  The
                     rings LIGHT UP with the weight: brightness and line
                     width ∝ weight, so only the members consistent with
                     the observation survive.

   Controls: L_sprd (centre-position error, units of R_mw), N_ens (shared
   ensemble size), and a "new ensemble" button.  The observation value is
   fixed at truth + 3σ_o — a deliberately unlikely realization that exposes
   the filters' differences — and the readout reports how far the centres
   are pulled toward the truth and how many particles effectively survive
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

  let NENS = 100;                     // ensemble size (tunable)
  let Lsprd = 1.5 * RMW;              // location spread, grid points (default 1.5 Rmw)
  let sel = 49;                       // highlighted member, 0-based (default #50)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  const V_T = uWind(C_I, C_J, P_I, P_J);          // truth zonal wind at P
  const Y_OBS = V_T + 3 * SIG_O;                  // observed u at P (a 3σ_o outlier)

  // member palette (Tab20-style cycle — the SAME member keeps its colour in
  // all three panels, so its rings can be traced prior → EnKF → PF)
  const MEM_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  const memColor = (m) => MEM_COLORS[m % MEM_COLORS.length];
  // radii of the 20 m/s contour around a centre (analytic: one inside Rmw,
  // one outside — see the rankine widget)
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

  /* ------------------------------------------------- the two analyses */
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

  /* ------------------------------------------------------- spaghetti */
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

  // one spaghetti panel: every member's 20 m/s rings (styled per member), the
  // highlighted member on top, then the truth rings, the observation point P
  // and the axes.  styleFn(m) -> { color, alpha, lw } (return null to skip).
  function drawEnsembleMap(cv, centres, styleFn) {
    const [ctx, W, H] = sizeCanvas(cv);
    const { margin, side, x0, y0, s } = aGeom(W, H);
    const [rIn, rOut] = ringRadii();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, side, side);
    ctx.clip();
    for (let m = 0; m < NENS; m++) {
      if (m === sel) continue;
      const st = styleFn(m);
      if (!st || st.alpha <= 0.01) continue;
      const cx = x0 + (centres.ci[m] - (C_I - WIN)) * s;
      const cy = y0 + (centres.cj[m] - (C_J - WIN)) * s;
      ctx.strokeStyle = hexA(st.color, st.alpha);
      ctx.lineWidth = st.lw;
      ctx.beginPath();
      ctx.arc(cx, cy, rIn * s, 0, 6.2832);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, rOut * s, 0, 6.2832);
      ctx.stroke();
    }
    // the highlighted member: white halo + thick ring in its colour
    {
      const cx = x0 + (centres.ci[sel] - (C_I - WIN)) * s;
      const cy = y0 + (centres.cj[sel] - (C_J - WIN)) * s;
      ctx.strokeStyle = hexA(T.surface1, 0.9);
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rIn * s, 0, 6.2832);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, rOut * s, 0, 6.2832);
      ctx.stroke();
      ctx.strokeStyle = memColor(sel);
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(cx, cy, rIn * s, 0, 6.2832);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, rOut * s, 0, 6.2832);
      ctx.stroke();
    }
    // truth rings (thick)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(x0 + WIN * s, y0 + WIN * s, rIn * s, 0, 6.2832);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x0 + WIN * s, y0 + WIN * s, rOut * s, 0, 6.2832);
    ctx.stroke();
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

  /* ------------------------------------------------------------ glue */
  function render() {
    updateT();
    const c = compute();

    // panel (a): prior — every member coloured, equally dim
    drawEnsembleMap(cvPrior, { ci, cj }, (m) => ({ color: memColor(m), alpha: 0.42, lw: 1 }));

    // panel (b): EnKF analysis
    drawEnsembleMap(cvEnKF, { ci: c.ai, cj: c.aj }, (m) => ({ color: memColor(m), alpha: 0.55, lw: 1 }));

    // panel (c): PF posterior — brightness AND width ∝ weight ("light up")
    drawEnsembleMap(cvPF, { ci, cj }, (m) => ({
      color: memColor(m),
      alpha: 0.08 + 0.92 * (c.w[m] / c.wmax),
      lw: 1 + 1.7 * (c.w[m] / c.wmax),
    }));

    // readout
    const km = (g) => (g * DX).toFixed(0);
    const wsel = c.w[sel] * 100;
    const wTxt = wsel < 0.05 ? "\u22480%" : wsel.toFixed(1) + "%";
    $("pf-readout").innerHTML =
      `obs u(P) = <strong>${Y_OBS.toFixed(1)} m/s</strong> (&sigma;<sub>o</sub> = ${SIG_O.toFixed(1)}) ` +
      `&#183; centre distance from truth (rms): prior <strong>${km(c.rmsP)} km</strong> ` +
      `&rarr; EnKF <strong>${km(c.rmsE)} km</strong> &#183; PF (weighted) <strong>${km(c.rmsW)} km</strong> ` +
      `&#183; N<sub>eff</sub> = <strong>${c.neff.toFixed(0)}</strong> of ${NENS} ` +
      `&#183; member <strong>${sel + 1}</strong> w <strong>${wTxt}</strong> (max <strong>${(c.wmax * 100).toFixed(1)}%</strong>)`;
  }

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
    sel = Math.min(sel, NENS - 1);
    selSlider.max = NENS;
    selSlider.value = sel + 1;
    selVal.textContent = sel + 1;
    render();
  });
  const selSlider = $("pf-sel"), selVal = $("pf-sel-val");
  selSlider.addEventListener("input", () => {
    sel = clamp(parseInt(selSlider.value, 10) || 1, 1, NENS) - 1;
    selVal.textContent = sel + 1;
    render();
  });
  rerunBtn.addEventListener("click", () => { sampleEnsemble(); render(); });

  root.dataset.theme = theme;           // apply theme variables before the first render
  sprdSlider.value = (Lsprd / RMW).toFixed(1);
  sprdVal.innerHTML = (Lsprd / RMW).toFixed(1) + " R<sub>mw</sub>";
  nensSlider.value = NENS;
  nensVal.textContent = NENS;
  selSlider.max = NENS;
  selSlider.value = sel + 1;
  selVal.textContent = sel + 1;
  sampleEnsemble();
  render();

  const ro = new ResizeObserver(render);
  [cvPrior, cvEnKF, cvPF].forEach((cv) => ro.observe(cv));
})();
