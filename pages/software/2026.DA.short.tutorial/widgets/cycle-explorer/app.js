/* Cycling the EnKF — Ch. 3, section 2.

   The same warm blob as Chapter 2/6 (peak A = 8 K, radius scale SIG = 50 km,
   Ch. 2's own scale), now a moving storm on a PERIODIC domain: its centre
   drifts at a constant, PERFECTLY KNOWN velocity — no process error, no
   noise, the simplest possible dynamical system — and wraps around when it
   crosses an edge, so it keeps cycling past the observing network forever.
   A small network of fixed ground stations (same idiom as Ch. 2/3/6's
   single point P, just several of them, evenly spaced to cover the whole
   domain) is sampled once per cycle as the storm passes near each — with a
   grid instead of one point, the storm is always within reach of at least
   one station, no matter where on the domain it currently sits.

   Each cycle is forecast -> observe -> analyze, exactly like the Ch. 3 §1
   widget's single step, just repeated once per station, in sequence:
     x_a^m = x_b^m + K (y^m - H x_b^m),   K = cov(state, Hx) / (var(Hx) + R)
   but now the "state" is the low-dimensional vector (cx, cy) — the storm's
   centre — instead of a full gridded field, so the vector Kalman update is
   exact here, not a shortcut (contrast with Ch. 6 §2, where the true state
   IS the full field and updating only a centre parameter was shown to be
   wrong).

   Because every member (and the truth) is advected by the exact SAME known
   velocity every cycle, the forecast step is a pure shared translation: it
   neither grows nor shrinks the ensemble spread, and the ensemble mean
   always tracks the truth exactly. Only the analysis step changes the
   spread, and a Kalman analysis always shrinks it. With nothing to
   replenish it, spread shrinks, cycle after cycle, forever — with a
   perfect model that's harmless (the mean stays exactly on the truth
   regardless), but watch the number: Chapter 4 changes exactly one thing
   about this setup and watches it become a problem.

   Controls: run / reset.

   Embedding-ready: root is the element with id="cycle-explorer" (falls back
   to .da-widget / document root), theme follows prefers-color-scheme, and
   a ResizeObserver re-renders on reflow.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("cycle-explorer") || document.querySelector(".da-widget") || document.documentElement;
  const cvMap = $("cyc-map"), cvTs = $("cyc-ts");
  const runBtn = $("cyc-run"), resetBtn = $("cyc-reset");

  /* ------------------------------------------------------------- model */
  const A = 8, SIG = 50;                // hump peak (K), radius scale (km, Ch. 2's own scale)
  const RING = 4;                       // K contour drawn as the storm's footprint
  const RING_R = SIG * Math.sqrt(2 * Math.log(A / RING));   // ~58.9 km
  const DOM = 250;                      // plotted half-domain, km (Ch. 2's 500x500 km domain)
  const WRAP = 2 * DOM;                 // domain is periodic: exiting one edge re-enters the opposite one
  const wrap = (v) => ((v + DOM) % WRAP + WRAP) % WRAP - DOM;
  const MAXHIST = 600;                  // rolling window (cycles) kept for the track + time series
  const MAX_STEPS = 500;               // auto-run stops here so the widget can't run forever unattended
  const TICKS_KM = [-200, -100, 0, 100, 200];

  const C0 = { x: -200, y: 80 };        // truth's starting centre, km
  const VEL = { u: 9, v: -3 };          // MEAN velocity, km/cycle — known to the filter
  // a 3x3 network of nine fixed ground stations, evenly spaced across the
  // periodic domain so every point is within reach of at least one station
  const STATIONS = (() => {
    const g = DOM * 2 / 3;               // ~166.7 km spacing
    const pts = [];
    for (const x of [-g, 0, g]) for (const y of [-g, 0, g]) pts.push({ x, y });
    return pts;
  })();

  const SIG_O = 1.0;                    // observation error std, K
  const NENS = 50;                      // ensemble size (fixed — not user-tunable)

  // periodic (shortest-path) difference on the wrap-around domain
  function pdiff(a, b) {
    let d = a - b;
    d -= WRAP * Math.round(d / WRAP);
    return d;
  }
  function field(cx, cy, x, y) {
    const dx = pdiff(cx, x), dy = pdiff(cy, y);
    return A * Math.exp(-(dx * dx + dy * dy) / (2 * SIG * SIG));
  }
  // circular mean of a periodic array: average each value's shortest signed
  // displacement from a reference (the first element), then wrap back. A
  // plain arithmetic mean is wrong once the ensemble straddles the domain
  // seam (e.g. half the members near +249 km, half near -249 km) — it would
  // average to ~0 instead of recognizing they're actually close together.
  function circMean(arr) {
    const ref = arr[0];
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += pdiff(arr[i], ref);
    return wrap(ref + s / arr.length);
  }

  // member palette (Tab20-style cycle, same as the other tutorial widgets)
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
    surface1: "#fcfcfb", ink1: "#0b0b0b", ink2: "#52514e", ink3: "#898781", axis: "#c3c2b7",
    blue: "#2b7bba", red: "#e34948", amber: "#eda100"
  };
  const updateT = () => {
    const kv = (n, f) => { const v = cssVar(n); if (v) f(v); };
    kv("--surface-1", v => T.surface1 = v); kv("--ink-1", v => T.ink1 = v);
    kv("--ink-2", v => T.ink2 = v); kv("--ink-3", v => T.ink3 = v); kv("--axis", v => T.axis = v);
    kv("--series-blue", v => T.blue = v); kv("--series-red", v => T.red = v); kv("--series-amber", v => T.amber = v);
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
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  /* --------------------------------------------------------- geometry */
  function mapGeom(W, H) {
    const margin = { l: 40, r: 12, t: 12, b: 30 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;
    const side = Math.min(pw, ph);
    const x0 = margin.l + (pw - side) / 2, y0 = margin.t + (ph - side) / 2;
    const s = side / (2 * DOM);
    // km -> canvas (y flipped: north is up)
    const X = (km) => x0 + (km + DOM) * s;
    const Y = (km) => y0 + (DOM - km) * s;
    return { margin, side, x0, y0, s, X, Y };
  }

  /* ------------------------------------------------------------- state */
  let truth = { x: C0.x, y: C0.y };
  let ci = new Float64Array(NENS), cj = new Float64Array(NENS);
  let cycle = 0;
  let history = [];             // [{cycle, spread, rmse}], rolling window of MAXHIST
  let truthTrack = [];          // [{x, y}], rolling window, for drawing the track (broken at wrap jumps)
  let running = false, timer = null;

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

  const LSPRD0 = SIG;   // initial position spread (km), same "1 sigma" convention as Ch. 2/6

  function resetAll() {
    truth = { x: C0.x, y: C0.y };
    ci = new Float64Array(NENS); cj = new Float64Array(NENS);
    for (let m = 0; m < NENS; m++) {
      ci[m] = C0.x + gauss() * LSPRD0;
      cj[m] = C0.y + gauss() * LSPRD0;
    }
    cycle = 0;
    history = [];
    truthTrack = [{ x: truth.x, y: truth.y }];
    pushHistory();
    render();
  }

  function ensembleStats() {
    const mx = circMean(ci), my = circMean(cj);
    let varSum = 0;
    for (let m = 0; m < NENS; m++) {
      const dx = pdiff(ci[m], mx), dy = pdiff(cj[m], my);
      varSum += dx * dx + dy * dy;
    }
    const spread = Math.sqrt(varSum / NENS);
    const rmse = Math.hypot(pdiff(mx, truth.x), pdiff(my, truth.y));
    return { mx, my, spread, rmse };
  }

  function pushHistory() {
    const st = ensembleStats();
    history.push({ cycle, spread: st.spread, rmse: st.rmse });
    if (history.length > MAXHIST) history.shift();
  }

  function stepOnce() {
    // forecast: truth AND every member move by the exact same known
    // velocity — no noise, nothing hidden, a purely deterministic
    // perfect-model forecast. The domain is periodic, so wrap positions
    // back in range instead of letting the storm run off into empty space
    // forever.
    truth.x = wrap(truth.x + VEL.u);
    truth.y = wrap(truth.y + VEL.v);
    for (let m = 0; m < NENS; m++) {
      ci[m] = wrap(ci[m] + VEL.u);
      cj[m] = wrap(cj[m] + VEL.v);
    }
    cycle++;
    truthTrack.push({ x: truth.x, y: truth.y });
    if (truthTrack.length > MAXHIST) truthTrack.shift();

    // observe + analyze at each station in turn (serial EnKF): T(P_k) from
    // the truth, plus noise, then a vector Kalman update on (cx, cy) — exact
    // here, since the true state genuinely IS just a centre position
    for (const P of STATIONS) {
      const hxb = new Float64Array(NENS);
      for (let m = 0; m < NENS; m++) hxb[m] = field(ci[m], cj[m], P.x, P.y);
      const yTrue = field(truth.x, truth.y, P.x, P.y);
      const yObs = yTrue + gauss() * SIG_O;

      let hxbMean = 0;
      for (let m = 0; m < NENS; m++) hxbMean += hxb[m];
      hxbMean /= NENS;
      const cIbar = circMean(ci), cJbar = circMean(cj);
      let varB = 0, covI = 0, covJ = 0;
      for (let m = 0; m < NENS; m++) {
        const dh = hxb[m] - hxbMean, di = pdiff(ci[m], cIbar), dj = pdiff(cj[m], cJbar);
        varB += dh * dh; covI += di * dh; covJ += dj * dh;
      }
      const n1 = NENS - 1;
      varB /= n1; covI /= n1; covJ /= n1;
      const R = SIG_O * SIG_O, denom = varB + R;
      const KI = covI / denom, KJ = covJ / denom;
      for (let m = 0; m < NENS; m++) {
        const om = yObs + gauss() * SIG_O;          // perturbed obs (stochastic EnKF)
        const inc = om - hxb[m];
        ci[m] += KI * inc;
        cj[m] += KJ * inc;
      }
    }
    for (let m = 0; m < NENS; m++) { ci[m] = wrap(ci[m]); cj[m] = wrap(cj[m]); }

    pushHistory();
  }

  /* --------------------------------------------------------------- map */
  function drawMap() {
    const [ctx, W, H] = sizeCanvas(cvMap);
    const { margin, side, x0, y0, s, X, Y } = mapGeom(W, H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, side, side);
    ctx.clip();

    // truth track so far — broken into separate segments at wrap jumps
    ctx.strokeStyle = T.ink1;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    let trackStarted = false, prevPt = null;
    for (const pt of truthTrack) {
      if (prevPt && (Math.abs(pt.x - prevPt.x) > DOM || Math.abs(pt.y - prevPt.y) > DOM)) trackStarted = false;
      if (!trackStarted) { ctx.moveTo(X(pt.x), Y(pt.y)); trackStarted = true; }
      else ctx.lineTo(X(pt.x), Y(pt.y));
      prevPt = pt;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // member dots
    for (let m = 0; m < NENS; m++) {
      ctx.beginPath();
      ctx.arc(X(ci[m]), Y(cj[m]), 3, 0, 6.2832);
      ctx.fillStyle = hexA(T.blue, 0.5);
      ctx.fill();
    }
    // ensemble mean
    const st = ensembleStats();
    ctx.beginPath();
    ctx.arc(X(st.mx), Y(st.my), 5, 0, 6.2832);
    ctx.fillStyle = T.amber;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = T.ink1;
    ctx.stroke();

    // truth ring (4 K footprint) + centre dot
    ctx.beginPath();
    ctx.arc(X(truth.x), Y(truth.y), RING_R * s, 0, 6.2832);
    ctx.strokeStyle = theme === "dark" ? "#241439" : "#ffffff";
    ctx.lineWidth = 3.2; ctx.globalAlpha = 0.9; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = T.ink1; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(truth.x), Y(truth.y), 3.5, 0, 6.2832);
    ctx.fillStyle = T.ink1;
    ctx.fill();

    ctx.restore();

    // observation stations — white crosses with a dark halo
    ctx.lineCap = "round";
    for (const P of STATIONS) {
      const px = X(P.x), py = Y(P.y), ms = 7;
      ctx.strokeStyle = "#101010"; ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(px - ms, py); ctx.lineTo(px + ms, py);
      ctx.moveTo(px, py - ms); ctx.lineTo(px, py + ms);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(px - ms, py); ctx.lineTo(px + ms, py);
      ctx.moveTo(px, py - ms); ctx.lineTo(px, py + ms);
      ctx.stroke();
    }
    ctx.lineCap = "butt";

    // axes
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, side, side);
    ctx.fillStyle = T.ink3;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const km of TICKS_KM) {
      const xi = X(km);
      ctx.beginPath(); ctx.moveTo(xi, y0 + side); ctx.lineTo(xi, y0 + side + 4); ctx.stroke();
      ctx.fillText(String(km), xi, y0 + side + 6);
    }
    ctx.textBaseline = "middle";
    for (const km of TICKS_KM) {
      const yi = Y(km);
      ctx.beginPath(); ctx.moveTo(x0, yi); ctx.lineTo(x0 - 4, yi); ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(String(km), x0 - 6, yi);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("km", x0 + side / 2, y0 + side + 18);
  }

  /* --------------------------------------------------------- time series */
  function drawTs() {
    const [ctx, W, H] = sizeCanvas(cvTs);
    const margin = { l: 42, r: 12, t: 12, b: 30 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;

    const cMin = history.length ? history[0].cycle : 0;
    const cMax = Math.max(cMin + 20, cycle);
    let yMax = 20;
    for (const h of history) yMax = Math.max(yMax, h.spread, h.rmse);
    yMax = Math.ceil(yMax / 10) * 10;

    const X = (c) => margin.l + ((c - cMin) / (cMax - cMin)) * pw;
    const Y = (v) => margin.t + ph - (v / yMax) * ph;

    // grid + axes
    ctx.strokeStyle = hexA(T.axis, 0.5); ctx.lineWidth = 1;
    const ySteps = 4;
    for (let k = 0; k <= ySteps; k++) {
      const v = yMax * k / ySteps;
      ctx.beginPath(); ctx.moveTo(margin.l, Y(v)); ctx.lineTo(margin.l + pw, Y(v)); ctx.stroke();
    }
    ctx.strokeStyle = T.axis;
    ctx.strokeRect(margin.l, margin.t, pw, ph);
    ctx.fillStyle = T.ink3; ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let k = 0; k <= ySteps; k++) {
      const v = yMax * k / ySteps;
      ctx.fillText(String(Math.round(v)), margin.l - 6, Y(v));
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const span = cMax - cMin;
    const xStep = span <= 20 ? 5 : span <= 60 ? 10 : span <= 200 ? 20 : 50;
    const cStart = Math.ceil(cMin / xStep) * xStep;
    for (let c = cStart; c <= cMax; c += xStep) {
      ctx.beginPath(); ctx.moveTo(X(c), margin.t + ph); ctx.lineTo(X(c), margin.t + ph + 4); ctx.stroke();
      ctx.fillText(String(c), X(c), margin.t + ph + 6);
    }
    ctx.fillText("cycle", margin.l + pw / 2, margin.t + ph + 18);
    ctx.save();
    ctx.translate(12, margin.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("km", 0, 0);
    ctx.restore();

    // curves
    function curve(key, color, dash) {
      if (history.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      if (dash) ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = X(history[i].cycle), y = Y(history[i][key]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
    }
    curve("spread", T.blue, true);
    curve("rmse", T.red);
  }

  /* ------------------------------------------------------------ render */
  function render() {
    updateT();
    drawMap();
    drawTs();

    const st = ensembleStats();
    $("cyc-readout").innerHTML =
      `cycle <strong>${cycle}</strong> &#183; ensemble spread <strong>${st.spread.toFixed(0)} km</strong> ` +
      `&#183; rms error <strong>${st.rmse.toFixed(0)} km</strong>`;
  }

  /* --------------------------------------------------------------- glue */
  function setRunning(on) {
    running = on;
    runBtn.textContent = running ? "⏸ pause" : "▶ run";
    runBtn.setAttribute("aria-pressed", String(running));
    if (timer) { clearInterval(timer); timer = null; }
    if (running) {
      timer = setInterval(() => {
        stepOnce();
        render();
        if (cycle >= MAX_STEPS) setRunning(false);
      }, 350);
    }
  }

  runBtn.addEventListener("click", () => setRunning(!running));
  resetBtn.addEventListener("click", () => { setRunning(false); resetAll(); });

  root.dataset.theme = theme;
  resetAll();

  const ro = new ResizeObserver(render);
  [cvMap, cvTs].forEach((cv) => ro.observe(cv));
  window.addEventListener("resize", render);
  setTheme(theme);
})();
