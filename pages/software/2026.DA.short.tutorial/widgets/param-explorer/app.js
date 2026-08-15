/* Parameter estimation — Ch. 7.

   The same cycling, 3x3 nine-station storm-tracking EnKF as Ch. 3 (same
   periodic domain, same station network, same purely deterministic truth
   — constant, exactly known velocity, no jitter anywhere), but the state
   vector is now augmented with the one thing that widget assumed was
   known: the storm's velocity itself. State = (cx, cy, u, v). Velocity is
   a PERSISTENCE variable — the
   forecast step carries each member's own (u, v) forward unchanged, it
   has no dynamics of its own — so the only way an ensemble member's
   velocity guess ever changes is through the analysis, via whatever
   cross-covariance builds up between "my velocity" and "the temperature
   I'd see at each station". That covariance is exactly the same mechanism
   Chapter 3 used to pull centre position toward the truth; here it pulls
   velocity too, because a member whose velocity has been carrying it
   toward higher observed values is, on average, a member whose velocity
   estimate deserves to grow.

   The members start with a rough first guess of the storm's velocity —
   biased LOW, mean speed 4 km/cycle vs. the true ~9.5, not "no idea" —
   with spread 3 km/cycle around that guess. Watch the velocity readout
   converge toward the true value purely from repeated station
   observations of temperature — nothing here ever observes velocity
   directly. An "Estimation: on/off" toggle lets you freeze velocity at
   whatever it currently is (no analysis update, no perturbation) to see
   what happens without it: the drift-speed panel goes flat instead of
   continuing to narrow.

   NO BIAS-CORRECTING INFLATION HERE, unlike Ch. 4 — and deliberately so.
   Velocity in this widget is a genuinely static, unknown PARAMETER: the
   truth's speed never changes, so there's no ongoing process uncertainty
   for inflation to compensate for. Velocity spread SHOULD shrink as the
   analysis accumulates evidence — that shrinkage is the filter correctly
   getting more confident about a fixed quantity, not the overconfidence
   problem Ch. 4 was about.

   POSITION GETS NO PERTURBATION AT ALL: it relies entirely on each
   member's own ESTIMATED VELOCITY (persisted forecast) to track the
   truth, the way it would in the real state-augmentation scenario this
   widget is demonstrating. Position perturbation was tried (a slider,
   like Ch. 4's) and dropped — it turned out not to matter much either
   way here (confirmed numerically: 0 km performs about as well as a
   small nonzero value), so the simpler choice is to leave it out
   entirely rather than carry a control that doesn't do much.

   Velocity DOES still get a small background perturbation (VEL_PERT =
   0.05 km/cycle, applied after every analysis) — this one is not
   cosmetic: earlier testing tried VEL_PERT = 0 outright (letting spread collapse fully, the
   textbook-correct behavior for a static parameter), but a fully
   collapsed ensemble also loses all Kalman-gain leverage to self-correct
   — an early unlucky sample would occasionally leave the estimate
   permanently stuck away from the truth (confirmed numerically, roughly
   1 run in 4). A small constant "background inflation" fixes that: big
   enough to keep a sliver of spread alive so the gain never fully
   vanishes, small enough that it doesn't stop the estimate from actually
   converging. VEL_PERT = 0.05 was the sweet spot found by testing —
   0.4 and 0.1 (tried earlier) were themselves too large, leaving spread
   plateaued well above what real confidence in a converged answer should
   look like.

   Three panels: (1) storm track, as in Ch. 3/4; (2) drift speed — one
   cyan line per member (the ensemble read as a cluster) plus a thicker
   blue ensemble-mean line and a dashed true-speed reference; (3) the
   same position spread-vs-rms-error panel as Ch. 3/4 (not a
   velocity-specific one — velocity's own spread/error already has its
   own clearer picture in panel 2).

   Controls: run / reset / parameter-estimation toggle.

   Embedding-ready: root is the element with id="param-explorer" (falls back
   to .da-widget / document root), theme follows prefers-color-scheme, and
   a ResizeObserver re-renders on reflow.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("param-explorer") || document.querySelector(".da-widget") || document.documentElement;
  const cvMap = $("param-map"), cvTs = $("param-ts"), cvSpd = $("param-spd");
  const runBtn = $("param-run"), resetBtn = $("param-reset");
  const estBtn = $("param-est");

  /* ------------------------------------------------------------- model */
  const A = 8, SIG = 50;                // hump peak (K), radius scale (km, Ch. 2's own scale)
  const RING = 4;
  const RING_R = SIG * Math.sqrt(2 * Math.log(A / RING));   // ~58.9 km
  const DOM = 250;
  const WRAP = 2 * DOM;                 // domain is periodic: exiting one edge re-enters the opposite one
  const wrap = (v) => ((v + DOM) % WRAP + WRAP) % WRAP - DOM;
  const MAXHIST = 600;                  // rolling window (cycles) kept for the track + time series
  const MAX_STEPS = 500;               // auto-run stops here so the widget can't run forever unattended
  const TICKS_KM = [-200, -100, 0, 100, 200];

  const C0 = { x: -200, y: 80 };        // truth's starting centre, km
  const VEL_TRUE = { u: 9, v: -3 };     // true velocity, km/cycle — UNKNOWN to the filter
  // a 3x3 network of nine fixed ground stations, evenly spaced across the
  // periodic domain so every point is within reach of at least one station
  const STATIONS = (() => {
    const g = DOM * 2 / 3;               // ~166.7 km spacing
    const pts = [];
    for (const x of [-g, 0, g]) for (const y of [-g, 0, g]) pts.push({ x, y });
    return pts;
  })();

  const LSPRD0 = SIG;                   // initial position spread, km
  const VSPRD0 = 3;                     // initial velocity-guess spread, km/cycle
  const VGUESS0 = { u: 3.79, v: -1.26 };   // initial velocity guess: mean speed 4 km/cycle (true direction, true speed ~9.5), not "no idea"

  const SIG_O = 1.0;
  const NENS = 50;                      // ensemble size (fixed — not user-tunable)
  const VEL_PERT = 0.05;                // std (km/cycle) of each member's post-analysis velocity kick — small background inflation

  let ESTIMATE_VEL = true;              // toggle: when off, velocity is frozen — not analyzed or perturbed

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
  // circular mean of a periodic array (see cycle-explorer for why a plain
  // arithmetic mean breaks once the ensemble straddles the domain seam) —
  // only ever used for position (cx, cy); velocity (u, v) is not periodic
  function circMean(arr) {
    const ref = arr[0];
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += pdiff(arr[i], ref);
    return wrap(ref + s / arr.length);
  }

  /* ------------------------------------------------------------- theme */
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const T = {
    surface1: "#fcfcfb", ink1: "#0b0b0b", ink2: "#52514e", ink3: "#898781", axis: "#c3c2b7",
    blue: "#2b7bba", red: "#e34948", amber: "#eda100", cyan: "#17becf"
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

  function mapGeom(W, H) {
    const margin = { l: 40, r: 12, t: 12, b: 30 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;
    const side = Math.min(pw, ph);
    const x0 = margin.l + (pw - side) / 2, y0 = margin.t + (ph - side) / 2;
    const s = side / (2 * DOM);
    const X = (km) => x0 + (km + DOM) * s;
    const Y = (km) => y0 + (DOM - km) * s;
    return { margin, side, x0, y0, s, X, Y };
  }

  /* ------------------------------------------------------------- state */
  let truth = { x: C0.x, y: C0.y };
  let ci, cj, cu, cv;
  let cycle = 0;
  let history = [];             // [{cycle, spread, rmse, vSpread, vErr}], rolling window of MAXHIST
  let speedHistory = [];        // [{cycle, speeds: Float64Array(NENS)}], per-member drift speed, rolling window of MAXHIST
  let truthTrack = [];          // rolling window, for drawing the track (broken at wrap jumps)
  let running = false, timer = null;

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

  function resetAll() {
    truth = { x: C0.x, y: C0.y };
    ci = new Float64Array(NENS); cj = new Float64Array(NENS);
    cu = new Float64Array(NENS); cv = new Float64Array(NENS);
    for (let m = 0; m < NENS; m++) {
      ci[m] = C0.x + gauss() * LSPRD0;
      cj[m] = C0.y + gauss() * LSPRD0;
      cu[m] = VGUESS0.u + gauss() * VSPRD0;
      cv[m] = VGUESS0.v + gauss() * VSPRD0;
    }
    cycle = 0;
    history = [];
    speedHistory = [];
    truthTrack = [{ x: truth.x, y: truth.y }];
    pushHistory();
    render();
  }

  function ensembleStats() {
    const mx = circMean(ci), my = circMean(cj);
    let mu = 0, mv = 0;
    for (let m = 0; m < NENS; m++) { mu += cu[m]; mv += cv[m]; }
    mu /= NENS; mv /= NENS;
    let varPos = 0, varVel = 0;
    for (let m = 0; m < NENS; m++) {
      const dx = pdiff(ci[m], mx), dy = pdiff(cj[m], my), du = cu[m] - mu, dv = cv[m] - mv;
      varPos += dx * dx + dy * dy;
      varVel += du * du + dv * dv;
    }
    const spread = Math.sqrt(varPos / NENS);
    const vSpread = Math.sqrt(varVel / NENS);
    const rmse = Math.hypot(pdiff(mx, truth.x), pdiff(my, truth.y));
    const vErr = Math.hypot(mu - VEL_TRUE.u, mv - VEL_TRUE.v);
    const speed = Math.hypot(mu, mv);
    return { mx, my, mu, mv, spread, vSpread, rmse, vErr, speed };
  }

  function pushHistory() {
    const st = ensembleStats();
    history.push({ cycle, spread: st.spread, rmse: st.rmse, vSpread: st.vSpread, vErr: st.vErr, speed: st.speed });
    if (history.length > MAXHIST) history.shift();

    const speeds = new Float64Array(NENS);
    for (let m = 0; m < NENS; m++) speeds[m] = Math.hypot(cu[m], cv[m]);
    speedHistory.push({ cycle, speeds });
    if (speedHistory.length > MAXHIST) speedHistory.shift();
  }

  function stepOnce() {
    // forecast: truth moves at its exact, constant true velocity — purely
    // deterministic, no jitter — while each member is carried by ITS OWN
    // (persisted) velocity guess. The domain is periodic, so wrap
    // positions back in range instead of letting the storm run off into
    // empty space forever.
    truth.x = wrap(truth.x + VEL_TRUE.u);
    truth.y = wrap(truth.y + VEL_TRUE.v);
    for (let m = 0; m < NENS; m++) { ci[m] = wrap(ci[m] + cu[m]); cj[m] = wrap(cj[m] + cv[m]); }
    cycle++;
    truthTrack.push({ x: truth.x, y: truth.y });
    if (truthTrack.length > MAXHIST) truthTrack.shift();

    // observe + analyze at each station in turn (serial EnKF) on the
    // augmented state (cx, cy, u, v)
    for (const P of STATIONS) {
      const hxb = new Float64Array(NENS);
      for (let m = 0; m < NENS; m++) hxb[m] = field(ci[m], cj[m], P.x, P.y);
      const yTrue = field(truth.x, truth.y, P.x, P.y);
      const yObs = yTrue + gauss() * SIG_O;

      let hxbMean = 0;
      for (let m = 0; m < NENS; m++) hxbMean += hxb[m];
      hxbMean /= NENS;
      const bx = circMean(ci), by = circMean(cj);
      let bu = 0, bv = 0;
      for (let m = 0; m < NENS; m++) { bu += cu[m]; bv += cv[m]; }
      bu /= NENS; bv /= NENS;
      let varB = 0, covX = 0, covY = 0, covU = 0, covV = 0;
      for (let m = 0; m < NENS; m++) {
        const dh = hxb[m] - hxbMean;
        varB += dh * dh;
        covX += pdiff(ci[m], bx) * dh; covY += pdiff(cj[m], by) * dh;
        covU += (cu[m] - bu) * dh; covV += (cv[m] - bv) * dh;
      }
      const n1 = NENS - 1;
      varB /= n1; covX /= n1; covY /= n1; covU /= n1; covV /= n1;
      const R = SIG_O * SIG_O, denom = varB + R;
      const KX = covX / denom, KY = covY / denom, KU = covU / denom, KV = covV / denom;
      for (let m = 0; m < NENS; m++) {
        const om = yObs + gauss() * SIG_O;
        const inc = om - hxb[m];
        ci[m] += KX * inc; cj[m] += KY * inc;
        if (ESTIMATE_VEL) { cu[m] += KU * inc; cv[m] += KV * inc; }
      }
    }
    for (let m = 0; m < NENS; m++) { ci[m] = wrap(ci[m]); cj[m] = wrap(cj[m]); }

    // small background velocity perturbation (see header) — position gets
    // none: it relies entirely on each member's own estimated velocity to
    // track the truth. Velocity is frozen (no analysis, no perturbation)
    // while estimation is toggled off.
    if (ESTIMATE_VEL) {
      for (let m = 0; m < NENS; m++) { cu[m] += gauss() * VEL_PERT; cv[m] += gauss() * VEL_PERT; }
    }

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
    const st = ensembleStats();

    // ensemble mean
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

    // observation stations
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

  /* ------------------------------------------------------- drift speed */
  function drawSpeed() {
    const [ctx, W, H] = sizeCanvas(cvSpd);
    const margin = { l: 42, r: 12, t: 12, b: 30 };
    const pw = W - margin.l - margin.r, ph = H - margin.t - margin.b;

    const trueSpeed = Math.hypot(VEL_TRUE.u, VEL_TRUE.v);
    const cMin = history.length ? history[0].cycle : 0;
    const cMax = Math.max(cMin + 20, cycle);
    let yMax = Math.ceil(trueSpeed * 1.3);
    for (const h of history) yMax = Math.max(yMax, Math.ceil(h.speed * 1.1));
    // cap axis growth from early wide member spread — clip() handles outliers past this

    const X = (c) => margin.l + ((c - cMin) / (cMax - cMin)) * pw;
    const Y = (v) => margin.t + ph - (v / yMax) * ph;

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
      ctx.fillText(v.toFixed(1), margin.l - 6, Y(v));
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
    ctx.fillText("km/cycle", 0, 0);
    ctx.restore();

    // per-member drift-speed trajectories — one thin line per member, so
    // the ensemble reads as a cluster of curves narrowing toward the truth
    if (speedHistory.length >= 2) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.l, margin.t, pw, ph);
      ctx.clip();
      ctx.strokeStyle = hexA(T.cyan, 0.45); ctx.lineWidth = 1;
      for (let m = 0; m < NENS; m++) {
        ctx.beginPath();
        for (let i = 0; i < speedHistory.length; i++) {
          const x = X(speedHistory[i].cycle), y = Y(speedHistory[i].speeds[m]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // true speed: fixed dashed reference line
    ctx.strokeStyle = T.ink1; ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(margin.l, Y(trueSpeed)); ctx.lineTo(margin.l + pw, Y(trueSpeed));
    ctx.stroke();
    ctx.setLineDash([]);

    // ensemble-mean speed estimate — haloed so it stays legible against the
    // cyan member cluster regardless of theme (dark mode's lighter blue can
    // otherwise read too close to the cyan member lines)
    if (history.length >= 2) {
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = X(history[i].cycle), y = Y(history[i].speed);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexA(T.surface1, 0.9); ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = T.blue; ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------ render */
  function render() {
    updateT();
    drawMap();
    drawTs();
    drawSpeed();

    const st = ensembleStats();
    const trueSpeed = Math.hypot(VEL_TRUE.u, VEL_TRUE.v);
    $("param-readout").innerHTML =
      `cycle <strong>${cycle}</strong> &#183; velocity estimate <strong>(${st.mu.toFixed(1)}, ${st.mv.toFixed(1)})</strong> km/cycle ` +
      `(speed ${st.speed.toFixed(1)} of true ${trueSpeed.toFixed(1)}) &#183; ` +
      `velocity spread <strong>${st.vSpread.toFixed(2)}</strong> &#183; velocity error <strong>${st.vErr.toFixed(2)}</strong> km/cycle`;
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

  estBtn.addEventListener("click", () => {
    ESTIMATE_VEL = !ESTIMATE_VEL;
    estBtn.textContent = ESTIMATE_VEL ? "Estimation: on" : "Estimation: off";
    estBtn.setAttribute("aria-pressed", String(ESTIMATE_VEL));
  });

  root.dataset.theme = theme;
  resetAll();

  const ro = new ResizeObserver(render);
  [cvMap, cvTs, cvSpd].forEach((cv) => ro.observe(cv));
  window.addEventListener("resize", render);
  setTheme(theme);
})();
