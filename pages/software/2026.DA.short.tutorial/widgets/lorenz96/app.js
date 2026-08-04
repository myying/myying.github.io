/* Lorenz-96 chaos & predictability — "Challenges from dynamical systems"
   (Chapter 3 widget).

   Two panels:
     (a) Hovmoller — one contour level of the anomaly field x_i(t) - climatology
         over the 40 variables (y) vs lead time (x), drawn for the truth (thick)
         and for each member (thin, coloured): the contours coincide while the
         forecast is deterministic and fan out as the members decorrelate.
     (b) error vs spread — ensemble-mean RMSE vs truth (error) and ensemble
         spread, both growing toward the climatological variability of the
         system; the initial exponential phase gives the error-doubling time.

   Model: Lorenz (1996) 40-variable system, F = 8, RK4, dt = 0.05 (~6 h,
   1 time unit ≈ 5 days). The truth is spun up onto the attractor before the
   forecast starts; members start from the truth state plus N(0, σ²) noise on
   every variable.

   Embedding-ready (series convention): widget root is the element with
   id="lorenz96" (falls back to .da-widget / document root), theme follows
   prefers-color-scheme via the data-theme attribute, and a ResizeObserver
   re-renders when the page reflows the widget.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("lorenz96") || document.querySelector(".da-widget") || document.documentElement;
  const cvA = $("lz-plot-a"), cvB = $("lz-plot-b");
  const sigmaSlider = $("lz-sigma"), sigmaVal = $("lz-sigma-val");
  const nensSlider = $("lz-nens"), nensVal = $("lz-nens-val");
  const rerunBtn = $("lz-rerun");
  const showMembersToggle = $("lz-show-members");


  /* ------------------------------------------------------------- theme */
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const C = () => ({
    ink1: cssVar("--ink-1"), ink2: cssVar("--ink-2"), ink3: cssVar("--ink-3"),
    line: cssVar("--line"), axis: cssVar("--axis"), surface1: cssVar("--surface-1"),
    aqua: cssVar("--series-aqua"), amber: cssVar("--series-amber"),
    red: cssVar("--series-red"), ink: cssVar("--series-ink")
  });

  /* -------------------------------------------------------------- model */
  const N = 40, F = 8, DT = 0.05, TSPIN = 200, TMAX = 7, NSTEPS = Math.round(TMAX / DT);

  function dX(X, d) {
    for (let i = 0; i < N; i++) {
      d[i] = (X[(i + 1) % N] - X[(i - 2 + N) % N]) * X[(i - 1 + N) % N] - X[i] + F;
    }
  }
  function step(X) {                       // RK4, in place
    const k1 = new Float64Array(N), k2 = new Float64Array(N),
          k3 = new Float64Array(N), k4 = new Float64Array(N), t = new Float64Array(N);
    dX(X, k1);
    for (let i = 0; i < N; i++) t[i] = X[i] + DT / 2 * k1[i];
    dX(t, k2);
    for (let i = 0; i < N; i++) t[i] = X[i] + DT / 2 * k2[i];
    dX(t, k3);
    for (let i = 0; i < N; i++) t[i] = X[i] + DT * k3[i];
    dX(t, k4);
    for (let i = 0; i < N; i++) X[i] += DT / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  /* ----------------------------------------------- plotting helpers */
  const MS_EDGE_PTS = [[[0,0],[1,0]], [[1,0],[1,1]], [[1,1],[0,1]], [[0,1],[0,0]]];
  const MS_CASE = [
    [], [[0,3]], [[0,1]], [[1,3]], [[1,2]], [[3,0],[1,2]], [[0,2]], [[2,3]],
    [[2,3]], [[0,2]], [[0,1],[2,3]], [[1,2]], [[1,3]], [[0,1]], [[0,3]], []
  ];
  function marchingSquares(vals, w, h, level) {   // segments in grid coords
    const cw = w + 1, ch = h + 1;
    const corners = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      let s = 0, n = 0;
      for (const [di, dj] of [[-1,-1],[0,-1],[-1,0],[0,0]]) {
        const cx = i + di, cy = j + dj;
        if (cx >= 0 && cx < w && cy >= 0 && cy < h) { s += vals[cy*w + cx]; n++; }
      }
      corners[j*cw + i] = s / n;
    }
    const segs = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v00 = corners[j*cw+i], v10 = corners[j*cw+i+1],
            v11 = corners[(j+1)*cw+i+1], v01 = corners[(j+1)*cw+i];
      let bits = 0;
      if (v00 >= level) bits |= 1;   // TL
      if (v10 >= level) bits |= 2;   // TR
      if (v11 >= level) bits |= 4;   // BR
      if (v01 >= level) bits |= 8;   // BL
      const pairs = MS_CASE[bits];
      for (const [e0, e1] of pairs) {
        const interp = (e) => {
          const pt = MS_EDGE_PTS[e];
          const va = corners[(j+pt[0][1])*cw + (i+pt[0][0])], vb = corners[(j+pt[1][1])*cw + (i+pt[1][0])];
          const t = (vb === va) ? 0 : (level - va) / (vb - va);
          return [i + pt[0][0] + (pt[1][0]-pt[0][0]) * t, j + pt[0][1] + (pt[1][1]-pt[0][1]) * t];
        };
        const a = interp(e0), b = interp(e1);
        segs.push([a[0], a[1], b[0], b[1]]);
      }
    }
    return segs;
  }
  // join contour segments that share endpoints into continuous polylines
  function chainSegments(segs) {
    if (!segs.length) return [];
    const key = (x, y) => Math.round(x * 1000) + ',' + Math.round(y * 1000);
    const ends = new Map();
    for (let i = 0; i < segs.length; i++) {
      const a = key(segs[i][0], segs[i][1]), b = key(segs[i][2], segs[i][3]);
      if (!ends.has(a)) ends.set(a, []);
      if (!ends.has(b)) ends.set(b, []);
      ends.get(a).push(i); ends.get(b).push(i);
    }
    const used = new Uint8Array(segs.length);
    const polys = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const poly = [segs[i][0], segs[i][1], segs[i][2], segs[i][3]];
      for (;;) {                                   // extend forward
        const k = key(poly[poly.length - 2], poly[poly.length - 1]);
        let nx = -1;
        for (const j of (ends.get(k) || [])) if (!used[j]) { nx = j; break; }
        if (nx < 0) break;
        used[nx] = 1;
        if (key(segs[nx][0], segs[nx][1]) === k) poly.push(segs[nx][2], segs[nx][3]);
        else poly.push(segs[nx][0], segs[nx][1]);
      }
      for (;;) {                                   // extend backward
        const k = key(poly[0], poly[1]);
        let nx = -1;
        for (const j of (ends.get(k) || [])) if (!used[j]) { nx = j; break; }
        if (nx < 0) break;
        used[nx] = 1;
        if (key(segs[nx][2], segs[nx][3]) === k) poly.unshift(segs[nx][0], segs[nx][1]);
        else poly.unshift(segs[nx][2], segs[nx][3]);
      }
      polys.push(poly);
    }
    return polys;
  }

  const TAB20 = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f',
    '#bcbd22','#17becf','#aec7e8','#ffbb78','#98df8a','#ff9896','#c5b0d5','#c49baa',
    '#f7b6d2','#c7c7c7','#dbdb8d','#9edae5'];
  const memberColor = m => TAB20[m % TAB20.length];

  /* -------------------------------------------------------------- state */
  const state = { sigma: 0.01, nens: 20, showMembers: true };
  let truth = null;        // (NSTEPS+1, N)  truth trajectory over the forecast
  let members = null;      // (nens, NSTEPS+1, N)
  let clim = null;         // (N) per-variable climatological mean (from the truth)
  let meanAnom = null;     // (N, NSTEPS+1) ensemble-mean anomaly xbar_i(t) - clim_i
  let anomMax = 0;         // max |x_m(i,t) - clim_i| over all members
  let contourLvl = 2;      // contour level: the x_i - clim_i = 2 line
  let error = null, spread = null, sat = 0, doublingDays = NaN, limitTu = NaN;

  function run() {
    // spin up truth onto the attractor
    const X = new Float64Array(N);
    for (let i = 0; i < N; i++) X[i] = Math.sin(i) + 0.01 * Math.random();
    for (let s = 0; s < Math.round(TSPIN / DT); s++) step(X);
    // truth forecast trajectory
    const T = new Float64Array(N); T.set(X);
    truth = new Float64Array((NSTEPS + 1) * N);
    truth.set(T);
    for (let k = 0; k < NSTEPS; k++) { step(T); truth.set(T, (k + 1) * N); }
    // climatological std from the truth trajectory (remove the time mean)
    const mn = new Float64Array(N), sd = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0, s2 = 0;
      for (let k = 0; k <= NSTEPS; k++) { const v = truth[k * N + i]; s += v; s2 += v * v; }
      mn[i] = s / (NSTEPS + 1);
      sd[i] = Math.sqrt(Math.max(0, s2 / (NSTEPS + 1) - mn[i] * mn[i]));
    }
    sat = sd.reduce((a, b) => a + b, 0) / N;
    clim = mn;
    // ensemble members from perturbed truth IC
    members = new Float64Array(state.nens * (NSTEPS + 1) * N);
    for (let m = 0; m < state.nens; m++) {
      const M = new Float64Array(N);
      for (let i = 0; i < N; i++) M[i] = truth[i] + state.sigma * gauss();
      members.set(M, m * (NSTEPS + 1) * N);
      for (let k = 0; k < NSTEPS; k++) {
        step(M);
        members.set(M, m * (NSTEPS + 1) * N + (k + 1) * N);
      }
    }
    // ensemble-mean anomaly field (variable-major: row i = variable i+1, col k = time)
    meanAnom = new Float64Array(N * (NSTEPS + 1));
    anomMax = 0;
    for (let k = 0; k <= NSTEPS; k++) {
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let mm = 0; mm < state.nens; mm++) {
          const a = members[mm * (NSTEPS + 1) * N + k * N + i] - clim[i];
          s += a;
          const ab = Math.abs(a);
          if (ab > anomMax) anomMax = ab;
        }
        meanAnom[i * (NSTEPS + 1) + k] = s / state.nens;
      }
    }
    // contour level: the x_i - clim_i = 2 line (close to the climatology, so the
    // contours trace the travelling-wave structure of the field)
    contourLvl = 2;
    // error (ensemble-mean RMSE vs truth) and spread (RMS std over members)
    error = new Float64Array(NSTEPS + 1);
    spread = new Float64Array(NSTEPS + 1);
    for (let k = 0; k <= NSTEPS; k++) {
      let e = 0, s = 0;
      for (let i = 0; i < N; i++) {
        let m = 0, m2 = 0;
        for (let mm = 0; mm < state.nens; mm++) {
          const v = members[mm * (NSTEPS + 1) * N + k * N + i];
          m += v; m2 += v * v;
        }
        m /= state.nens;
        const meanErr = m - truth[k * N + i];
        e += meanErr * meanErr;
        s += Math.max(0, m2 / state.nens - m * m);
      }
      error[k] = Math.sqrt(e / N);
      spread[k] = Math.sqrt(s / N);
    }
    // error-doubling time from the early exponential phase
    const thresh = 0.35 * sat;
    let k0 = 1, k1 = 1;
    for (let k = 1; k <= NSTEPS; k++) { if (error[k] < thresh) k1 = k; }
    // fit log(error) over [k0, k1]
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let k = k0; k <= k1; k++) {
      const t = k * DT, e = Math.log(Math.max(error[k], 1e-12));
      sx += t; sy += e; sxx += t * t; sxy += t * e; n++;
    }
    if (n > 3 && (n * sxx - sx * sx) !== 0) {
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      if (slope > 0) doublingDays = Math.log(2) / slope * 5;   // 1 tu = 5 days
      else doublingDays = NaN;
    }
    // predictability limit: first time error reaches 90% of saturation
    limitTu = NaN;
    for (let k = 1; k <= NSTEPS; k++) {
      if (error[k] >= 0.9 * sat) { limitTu = k * DT; break; }
    }
  }
  function gauss() {   // Box–Muller
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ------------------------------------------------------------- canvas */
  function setupCv(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // use the CSS box height when it is taller than 16:9 (the narrow-screen min-height
    // on #lz-plot-a); fall back to 16:9 of the width otherwise
    const w = cv.clientWidth, h = cv.clientHeight || Math.round(w * 9 / 16);
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [c, w, h];
  }
  function axes(c, W, H, x0, y0, x1, y1, xlab, ylab, xticks, yticks, xfmt, yfmt, col) {
    c.strokeStyle = col.axis; c.lineWidth = 1;
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    c.fillStyle = col.ink3; c.font = "10px system-ui, sans-serif";
    c.textAlign = "center";
    for (const [v, px] of xticks) c.fillText(xfmt ? xfmt(v) : String(v), px, y1 + 13);
    c.textAlign = "right";
    for (const [v, py] of yticks) c.fillText(yfmt ? yfmt(v) : String(v), x0 - 6, py + 3);
    c.textAlign = "center"; c.fillStyle = col.ink2;
    c.fillText(xlab, (x0 + x1) / 2, H - 3);
    c.save(); c.translate(11, (y0 + y1) / 2); c.rotate(-Math.PI / 2);
    c.fillText(ylab, 0, 0); c.restore();
  }

  function render() {
    if (!truth) return;
    const col = C();
    renderHovmoller(col);
    renderGrowth(col);
    renderReadout();
  }

  function renderHovmoller(col) {
    const [c, W, H] = setupCv(cvA);
    c.fillStyle = col.surface1; c.fillRect(0, 0, W, H);
    const m = { l: 44, r: 16, t: 14, b: 30 };
    const x0 = m.l, y0 = m.t, x1 = W - m.r, y1 = H - m.b;
    const plotW = x1 - x0, plotH = y1 - y0;
    const nT = NSTEPS + 1;                       // lead-time columns
    const cellX = plotW / nT, cellY = plotH / N;
    // frame + grid
    c.strokeStyle = col.axis; c.lineWidth = 1;
    c.strokeRect(x0, y0, plotW, plotH);
    c.strokeStyle = col.line;
    for (let k = 0; k <= 5; k++) {
      const px = x0 + (k / TMAX) * plotW;
      c.beginPath(); c.moveTo(px, y0); c.lineTo(px, y1); c.stroke();
    }
    for (let g = 0; g <= 4; g++) {
      const py = y0 + (g / 4) * plotH;
      c.beginPath(); c.moveTo(x0, py); c.lineTo(x1, py); c.stroke();
    }
    // anomaly field of a trajectory (row i = variable i+1, col k = lead time)
    const anomalyField = (src, off) => {
      const f = new Float64Array(nT * N);
      for (let i = 0; i < N; i++) for (let k = 0; k < nT; k++) f[i * nT + k] = src[off + k * N + i] - clim[i];
      return f;
    };
    const L = contourLvl;
    const polysOf = (f) => chainSegments(marchingSquares(f, nT, N, L));
    const drawPolys = (polys, style, width) => {
      c.strokeStyle = style; c.lineWidth = width;
      c.beginPath();
      for (const p of polys) {
        c.moveTo(x0 + p[0] * cellX, y0 + p[1] * cellY);
        for (let q = 2; q < p.length; q += 2) c.lineTo(x0 + p[q] * cellX, y0 + p[q + 1] * cellY);
      }
      c.stroke();
    };
    // one contour level, drawn for every member (thin, coloured) then the truth
    // (thick): the contours coincide while the forecast is deterministic and fan
    // out as the members decorrelate.
    if (state.showMembers) {
      for (let mm = 0; mm < Math.min(state.nens, TAB20.length); mm++) {
        c.globalAlpha = 0.9;
        drawPolys(polysOf(anomalyField(members, mm * (NSTEPS + 1) * N)), memberColor(mm), 1.2);
      }
      c.globalAlpha = 1;
    }
    drawPolys(polysOf(anomalyField(truth, 0)), col.ink, 2.2);
    // axes: x = lead time (days), y = variable index 1..40 (variable 1 at top)
    const xt = [];
    for (let t = 0; t <= TMAX; t += 1) xt.push([t, x0 + (t / TMAX) * plotW]);
    const yt = [];
    for (let i = 1; i <= N; i += 10) yt.push([i, y0 + ((i - 1) / (N - 1)) * plotH]);
    axes(c, W, H, x0, y0, x1, y1, "lead time (days)", "variable index i", xt, yt, null, null, col);
  }

  function renderGrowth(col) {
    const [c, W, H] = setupCv(cvB);
    c.fillStyle = col.surface1; c.fillRect(0, 0, W, H);
    const m = { l: 44, r: 16, t: 14, b: 30 };
    const x0 = m.l, y0 = m.t, x1 = W - m.r, y1 = H - m.b;
    const ymax = Math.max(1.2 * sat, 1.1 * Math.max(...error));
    const X = (t) => x0 + (t / TMAX) * (x1 - x0);
    const Y = (v) => y1 - (v / ymax) * (y1 - y0);
    // grid + saturation line
    c.strokeStyle = col.line; c.lineWidth = 1;
    for (let k = 0; k <= 5; k++) {
      const px = X(k); c.beginPath(); c.moveTo(px, y0); c.lineTo(px, y1); c.stroke();
    }
    for (let g = 0; g <= 4; g++) {
      const v = ymax * g / 4, py = Y(v);
      c.beginPath(); c.moveTo(x0, py); c.lineTo(x1, py); c.stroke();
      c.fillStyle = col.ink3; c.font = "10px system-ui, sans-serif"; c.textAlign = "right";
      c.fillText(v.toFixed(1), x0 - 6, py + 3);
    }
    c.setLineDash([3, 3]); c.strokeStyle = col.ink3; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, Y(sat)); c.lineTo(x1, Y(sat)); c.stroke();
    c.setLineDash([]);
    // spread (dashed amber)
    c.strokeStyle = col.amber; c.lineWidth = 2; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(X(0), Y(spread[0]));
    for (let k = 1; k <= NSTEPS; k++) c.lineTo(X(k * DT), Y(spread[k]));
    c.stroke(); c.setLineDash([]);
    // error (solid red)
    c.strokeStyle = col.red; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(X(0), Y(error[0]));
    for (let k = 1; k <= NSTEPS; k++) c.lineTo(X(k * DT), Y(error[k]));
    c.stroke();
    // predictability limit marker (line only; the value is in the readout)
    if (Number.isFinite(limitTu)) {
      const px = X(limitTu);
      c.strokeStyle = col.ink3; c.setLineDash([2, 3]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(px, y0); c.lineTo(px, y1); c.stroke(); c.setLineDash([]);
    }
    const xt = [];
    for (let t = 0; t <= TMAX; t += 1) xt.push([t, X(t)]);
    axes(c, W, H, x0, y0, x1, y1, "lead time (days)", "RMSE (x units)", xt, [], null, null, col);
  }

  function renderReadout() {
    const set = (id, txt) => { const el = $(id); if (el) el.innerHTML = txt; };
    set("lz-lvl", contourLvl.toFixed(0));
    set("lz-double", Number.isFinite(doublingDays) ? doublingDays.toFixed(1) : "&mdash;");
    set("lz-sat", sat.toFixed(2));
    set("lz-limit", Number.isFinite(limitTu) ? (limitTu * 5).toFixed(1) : "&mdash;");
  }

  /* ------------------------------------------------------------- events */
  sigmaSlider.addEventListener("input", () => {
    state.sigma = Math.pow(10, +sigmaSlider.value);
    sigmaVal.textContent = state.sigma.toExponential(1);
    run(); render();
  });
  nensSlider.addEventListener("input", () => {
    state.nens = +nensSlider.value;
    nensVal.textContent = state.nens;
    run(); render();
  });
  rerunBtn.addEventListener("click", () => { run(); render(); });
  showMembersToggle.addEventListener("change", () => {
    state.showMembers = showMembersToggle.checked;
    render();
  });

  /* -------------------------------------------------------------- init */
  sigmaVal.textContent = state.sigma.toExponential(1);
  nensVal.textContent = state.nens;
  new ResizeObserver(() => render()).observe(cvA);
  new ResizeObserver(() => render()).observe(cvB);
  setTheme(theme);
  run();
  render();
})();
