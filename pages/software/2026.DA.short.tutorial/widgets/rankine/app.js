/* Rankine vortex — position errors break the Gaussian assumption
   (Chapter 7 widget).

   Model: modified Rankine vortex as in ~/code/rankine/rankine_vortex.py
   (gen_vortex): solid-body rotation inside the radius of maximum wind and
   a (Rmw/r)^1.5 decay outside.  Vmax = 35 m/s, Rmw = 5 grid points, domain
   128 x 128 grid points (1152 km at dx = 9 km).

   The ensemble members differ ONLY in the location of the vortex centre:
   centre = truth centre + N(0, L_sprd) in each direction.  The observation
   point P sits southeast of the truth centre (compass 135 deg), just
   outside the radius of maximum wind, where the tangential flow is still
   nearly maximal.  The state watched at P is the zonal wind u.

   Panels:
     (a) the vortex ensemble — truth wind-speed field (shading) and the
         20 m/s ring of every member (thin, coloured) vs of the truth
         (thick); the observation point P is marked '+'.
     (b) the error distribution at P — histogram of the members' zonal
         wind u minus the truth value, with a Gaussian fit (dashed) through
         the same mean and std.  At small L_sprd the error is Gaussian;
         once L_sprd reaches ~Rmw the histogram skews and fattens.
     (c) the mechanism — zonal wind u at P as a function of the centre
         displacement toward P.  The map peaks as a member's core edge
         reaches P and reverses as its centre passes P: non-monotone, so a
         Gaussian cloud of centres does not map to a Gaussian wind at P.

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
  const rerunBtn = $("rk-rerun");

  /* ------------------------------------------------------------- model */
  const VMAX = 35, RMW = 5;            // m/s, grid points
  const RING = 20;                     // m/s contour shown in panel (a)
  const NENS = 400;                    // ensemble size
  const DX = 9.0;                      // km per grid point
  const C_I = 64, C_J = 64;            // truth centre (0.5 * 128)
  const P_ANG = 135 * Math.PI / 180;   // observation point: compass 135° = southeast
  const P_DIR = { i: Math.sin(P_ANG), j: -Math.cos(P_ANG) };   // (0.7071, 0.7071)
  const R0 = RMW + 0.3;                // slightly outside the radius of maximum wind
  const P_I = C_I + R0 * P_DIR.i, P_J = C_J + R0 * P_DIR.j;

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
  // radii of the RING m/s contour around a centre (analytic)
  function ringRadii() {
    return [RING * RMW / VMAX, RMW * Math.pow(VMAX / RING, 2 / 3)];
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

  let Lsprd = 3;                       // location spread (grid points)
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
  function lerp(a, b, t) {
    return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)];
  }
  function rgbStr(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }

  /* ------------------------------------------------------- panel (a) */
  const WIN = 15;                       // half-window in grid points
  const TICKS_KM = [-135, -90, -45, 0, 45, 90, 135];

  function renderA() {
    const [ctx, W, H] = sizeCanvas(cvA);
    const margin = { l: 44, r: 14, t: 14, b: 34 };
    const side = Math.min(W - margin.l - margin.r, H - margin.t - margin.b);
    const x0 = margin.l + (W - margin.l - margin.r - side) / 2;
    const y0 = margin.t;
    const s = side / (2 * WIN);         // px per grid point

    // truth wind-speed shading (banded, every 5 m/s) at 1 gp resolution
    const gw = 2 * WIN + 1;
    const img = ctx.createImageData(gw, gw);
    const lo = theme === "dark" ? [26, 26, 25] : [246, 246, 244];
    const hi = theme === "dark" ? [200, 200, 198] : [58, 58, 56];
    for (let j = 0; j < gw; j++) {
      for (let i = 0; i < gw; i++) {
        const gi = C_I - WIN + i, gj = C_J - WIN + j;
        const w = vtheta(Math.hypot(gi - C_I, gj - C_J));
        const level = Math.min(10, Math.floor(w / 5));
        const col = lerp(lo, hi, level / 10);
        const o = (j * gw + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1];
        img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    const tmp = document.createElement("canvas");
    tmp.width = gw; tmp.height = gw;
    tmp.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, x0, y0, side, side);

    // 20 m/s rings of the members (thin, coloured)
    const [rIn, rOut] = ringRadii();
    ctx.lineWidth = 1;
    for (let m = 0; m < NENS; m++) {
      ctx.strokeStyle = hexA(memColor(m), 0.45);
      ctx.beginPath();
      ctx.arc(x0 + (ci[m] - (C_I - WIN)) * s, y0 + (cj[m] - (C_J - WIN)) * s, rIn * s, 0, 6.2832);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x0 + (ci[m] - (C_I - WIN)) * s, y0 + (cj[m] - (C_J - WIN)) * s, rOut * s, 0, 6.2832);
      ctx.stroke();
    }

    // truth rings (thick)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 2.6;
    for (const r of [rIn, rOut]) {
      ctx.beginPath();
      ctx.arc(x0 + WIN * s, y0 + WIN * s, r * s, 0, 6.2832);
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
    ctx.textAlign = "left";
    ctx.fillText("km", x0 + side - 24, y0 + side + 6);
  }

  /* ------------------------------------------------------- panel (b) */
  function renderB() {
    const [ctx, W, H] = sizeCanvas(cvB);
    const margin = { l: 46, r: 12, t: 14, b: 30 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;

    // member errors at P
    const e = new Float64Array(NENS);
    let sum = 0;
    for (let m = 0; m < NENS; m++) { e[m] = uWind(ci[m], cj[m], P_I, P_J) - V_T; sum += e[m]; }
    const mu = sum / NENS;
    let v2 = 0, v3 = 0, v4 = 0;
    for (let m = 0; m < NENS; m++) {
      const d = e[m] - mu;
      v2 += d * d; v3 += d * d * d; v4 += d * d * d * d;
    }
    const sd = Math.sqrt(v2 / NENS);
    const skew = (v3 / NENS) / Math.pow(sd, 3);
    const kurt = (v4 / NENS) / Math.pow(sd, 4) - 3;

    // histogram
    let lo = Infinity, hi = -Infinity;
    for (let m = 0; m < NENS; m++) { if (e[m] < lo) lo = e[m]; if (e[m] > hi) hi = e[m]; }
    const pad = Math.max(0.5, (hi - lo) * 0.06);
    lo -= pad; hi += pad;
    const NB = 48;
    const binW = (hi - lo) / NB;
    const counts = new Float64Array(NB);
    for (let m = 0; m < NENS; m++) {
      let b = Math.floor((e[m] - lo) / binW);
      if (b < 0) b = 0; if (b >= NB) b = NB - 1;
      counts[b]++;
    }
    const cmax = Math.max.apply(null, counts);

    // zero line (e = 0)
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    const zx = margin.l + ((-lo) / (hi - lo)) * pw;
    ctx.beginPath(); ctx.moveTo(zx, margin.t); ctx.lineTo(zx, margin.t + ph); ctx.stroke();
    ctx.setLineDash([]);

    // bars
    for (let b = 0; b < NB; b++) {
      const bx = margin.l + b * binW / (hi - lo) * pw;
      const bw = Math.max(1, binW / (hi - lo) * pw - 1);
      const bh = (counts[b] / cmax) * ph;
      ctx.fillStyle = theme === "dark" ? hexA(T.amber, 0.5) : T.hair;
      ctx.fillRect(bx, margin.t + ph - bh, bw, bh);
    }

    // Gaussian fit (same mean & std)
    ctx.strokeStyle = T.ink2;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const yOf = (x) => margin.t + ph - (Math.exp(-0.5 * Math.pow((x - mu) / sd, 2)) /
      (sd * Math.sqrt(2 * Math.PI)) * binW * NENS) / cmax * ph;
    for (let i = 0; i <= 120; i++) {
      const x = lo + (hi - lo) * i / 120;
      const y = yOf(x);
      if (i === 0) ctx.moveTo(margin.l + (x - lo) / (hi - lo) * pw, y);
      else ctx.lineTo(margin.l + (x - lo) / (hi - lo) * pw, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // mean and +/- std markers
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 1.4;
    const mx = margin.l + ((mu - lo) / (hi - lo)) * pw;
    ctx.beginPath(); ctx.moveTo(mx, margin.t + 4); ctx.lineTo(mx, margin.t + ph); ctx.stroke();
    ctx.strokeStyle = hexA(T.ink3, 0.7);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const s of [1, -1]) {
      const sx = margin.l + ((mu + s * sd - lo) / (hi - lo)) * pw;
      ctx.beginPath(); ctx.moveTo(sx, margin.t + 4); ctx.lineTo(sx, margin.t + ph); ctx.stroke();
    }
    ctx.setLineDash([]);

    // axis
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
    ctx.strokeRect(margin.l, margin.t, pw, ph);
    ctx.fillStyle = T.ink3; ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    // nice ticks across the adaptive range
    const step = niceStep((hi - lo) / 5);
    const t0 = Math.ceil(lo / step) * step;
    for (let v = t0; v <= hi + 1e-9; v += step) {
      const xi = margin.l + ((v - lo) / (hi - lo)) * pw;
      ctx.beginPath(); ctx.moveTo(xi, margin.t + ph); ctx.lineTo(xi, margin.t + ph + 4); ctx.stroke();
      ctx.fillText(String(Math.round(v * 10) / 10), xi, margin.t + ph + 6);
    }
    ctx.textAlign = "right";
    ctx.fillText("m/s", margin.l + pw, margin.t + ph + 6);

    // readout spans
    const f2 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
    $("rk-skew").textContent = f2(skew);
    $("rk-kurt").textContent = f2(kurt);
    const verdictEl = $("rk-verdict");
    const gaussLike = Math.abs(skew) < 0.25 && Math.abs(kurt) < 0.35;
    let txt;
    if (gaussLike) txt = "≈ Gaussian";
    else {
      const parts = [];
      if (skew < -0.25) parts.push("left-skewed");
      else if (skew > 0.25) parts.push("right-skewed");
      else parts.push("symmetric");
      if (kurt < -0.35) parts.push("flat-topped");
      else if (kurt > 0.35) parts.push("heavy-tailed");
      txt = "non-Gaussian — " + parts.join(", ");
    }
    verdictEl.textContent = txt;
    verdictEl.style.color = gaussLike ? T.amber : T.red;
    $("rk-mean").textContent = (mu >= 0 ? "+" : "") + mu.toFixed(1);
    $("rk-std").textContent = sd.toFixed(1);
  }

  /* ------------------------------------------------------- panel (c) */
  const D_MIN = -12, D_MAX = 12;       // displacement range (grid points)

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
    const yOf = (v) => margin.t + ph - (v - (-40)) / (80) * ph;   // v in [-40, 40]

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

    // the map: zonal wind u at P vs centre displacement toward P
    // (peaks as the core edge passes P, reverses as the centre passes P)
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const d = D_MIN + (D_MAX - D_MIN) * i / 300;
      const v = uWind(C_I + d * P_DIR.i, C_J + d * P_DIR.j, P_I, P_J);
      if (i === 0) ctx.moveTo(xOf(d), yOf(v));
      else ctx.lineTo(xOf(d), yOf(v));
    }
    ctx.stroke();

    // member samples: (centre displacement toward P, zonal wind u at P)
    for (let m = 0; m < NENS; m++) {
      const d = (ci[m] - C_I) * P_DIR.i + (cj[m] - C_J) * P_DIR.j;
      ctx.fillStyle = hexA(memColor(m), 0.5);
      ctx.fillRect(xOf(d) - 1.2, yOf(uWind(ci[m], cj[m], P_I, P_J)) - 1.2, 2.4, 2.4);
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
    ctx.fillText("centre passes P", xOf(R0), margin.t + 2);

    // axes
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
    ctx.strokeRect(margin.l, margin.t, pw, ph);
    ctx.fillStyle = T.ink3;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const km of [-90, -45, 0, 45, 90]) {
      const d = km / DX;
      if (d < D_MIN || d > D_MAX) continue;
      const xi = xOf(d);
      ctx.beginPath(); ctx.moveTo(xi, margin.t + ph); ctx.lineTo(xi, margin.t + ph + 4); ctx.stroke();
      ctx.fillText(String(km), xi, margin.t + ph + 6);
    }
    ctx.textAlign = "right";
    ctx.fillText("km", margin.l + pw, margin.t + ph + 6);
    ctx.save();
    ctx.translate(12, margin.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("zonal wind u at P (m/s)", 0, 0);
    ctx.restore();
  }

  /* ------------------------------------------------------------ glue */
  function render() { updateT(); renderA(); renderB(); renderC(); }

  sprdSlider.addEventListener("input", () => {
    Lsprd = parseFloat(sprdSlider.value);
    sprdVal.textContent = Lsprd.toFixed(1) + " gp · " + (Lsprd * DX).toFixed(0) + " km";
    sampleEnsemble();
    render();
  });
  rerunBtn.addEventListener("click", () => { sampleEnsemble(); render(); });

  root.dataset.theme = theme;           // apply theme variables before the first render
  sprdVal.textContent = Lsprd.toFixed(1) + " gp · " + (Lsprd * DX).toFixed(0) + " km";
  sampleEnsemble();
  render();

  const ro = new ResizeObserver(render);
  [cvA, cvB, cvC].forEach((cv) => ro.observe(cv));
})();
