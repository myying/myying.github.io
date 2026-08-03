/* Bayesian Gaussian — "The data assimilation problem" (Chapter 1 widget).

   Scalar Bayes' rule for Gaussians:  posterior ∝ prior × likelihood.
   Sliders set the prior N(μ_b, σ_b²) and the observation likelihood
   N(y, σ_o²); the posterior N(μ_a, σ_a²) is computed analytically:

       μ_a  = ( μ_b/σ_b² + y/σ_o² ) / ( 1/σ_b² + 1/σ_o² )
       σ_a² = 1 / ( 1/σ_b² + 1/σ_o² )

   Embedding-ready copy (see series README): the widget root is
   document.querySelector(".da-widget") (falls back to the document root
   for standalone use), the theme follows prefers-color-scheme via the
   data-theme attribute, and a ResizeObserver re-renders when the site
   page reflows the widget.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("bayes-gaussian") || document.querySelector(".da-widget") || document.documentElement;

  // ------------------------------------------------------------- theme
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

  // -------------------------------------------------------------- state
  // [slider id, state key, value-span id]
  const SLIDERS = [
    ["bg-mu-b",     "muB",    "bg-mu-b-val"],
    ["bg-sigma-b",  "sigmaB", "bg-sigma-b-val"],
    ["bg-obs-mu",   "y",      "bg-obs-mu-val"],
    ["bg-obs-sigma","sigmaO", "bg-obs-sigma-val"],
  ];
  const state = { muB: 0, sigmaB: 1.0, y: 1.2, sigmaO: 0.5, showProduct: true };
  const fmt = (v) => (Math.abs(v) < 1e-9 ? "0.00" : v.toFixed(2));

  // --------------------------------------------------------------- math
  function gauss(x, mu, sigma) {
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
  }
  function posterior() {
    const pB = 1 / (state.sigmaB * state.sigmaB);
    const pO = 1 / (state.sigmaO * state.sigmaO);
    return {
      muA: (state.muB * pB + state.y * pO) / (pB + pO),
      sigmaA: 1 / Math.sqrt(pB + pO),
    };
  }

  // -------------------------------------------------------- plot domain
  const X_MIN = -6, X_MAX = 6, Y_MAX = 4.4;
  const XR = X_MAX - X_MIN;

  // -------------------------------------------------- canvas plumbing
  let ctxNullWarned = false;
  function fitCanvas(cv) {
    const rect = cv.getBoundingClientRect();
    // Bail out if the canvas isn't laid out yet (below the fold on first
    // paint): a later resize/load render fixes it.
    if (!(rect.width > 0.5) || !(rect.height > 0.5)) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    if (!ctx) {
      if (!ctxNullWarned) {
        ctxNullWarned = true;
        console.warn("[bayes-gaussian] canvas has no 2d context — skipping draw");
      }
      return null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  const STEPS = 240;   // samples across the plot width (1 per ~3 px)
  function drawCurve(ctx, X, Y, f, color, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= STEPS; k++) {
      const x = X_MIN + (k / STEPS) * XR;
      const sy = Y(Math.max(0, Math.min(Y_MAX, f(x))));
      if (first) { ctx.moveTo(X(x), sy); first = false; } else ctx.lineTo(X(x), sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function fillUnder(ctx, X, Y, f, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= STEPS; k++) {
      const x = X_MIN + (k / STEPS) * XR;
      const sy = Y(Math.max(0, Math.min(Y_MAX, f(x))));
      if (first) { ctx.moveTo(X(x), sy); first = false; } else ctx.lineTo(X(x), sy);
    }
    ctx.lineTo(X(X_MAX), Y(0));
    ctx.lineTo(X(X_MIN), Y(0));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // rug labels for the means below the x-axis, with greedy collision
  // avoidance (labels that land close together stack onto a second row).
  function drawMeanLabels(ctx, X, Y, means) {
    let prevX = -Infinity, prevRow = 0;
    for (const m of means.slice().sort((a, b) => a.mu - b.mu)) {
      const sx = X(m.mu);
      const row = sx - prevX < 42 ? Math.min(prevRow + 1, 2) : 0;
      ctx.fillStyle = cssVar("--series-" + m.color);
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m.text, sx, Y(0) + 21 + row * 12);
      prevX = sx; prevRow = row;
    }
  }

  // ------------------------------------------------------------- render
  function render() {
    const fit = fitCanvas($("bg-plot"));
    if (!fit) return;
    const { ctx, w, h } = fit;

    const mL = 34, mR = 10, mT = 14, mB = 46;
    const pw = w - mL - mR, ph = h - mT - mB;
    const X = (x) => mL + ((x - X_MIN) / XR) * pw;
    const Y = (y) => mT + (1 - y / Y_MAX) * ph;

    // grid
    ctx.strokeStyle = cssVar("--line");
    ctx.lineWidth = 1;
    for (let x = Math.ceil(X_MIN); x <= X_MAX; x++) {
      ctx.beginPath(); ctx.moveTo(X(x), mT); ctx.lineTo(X(x), mT + ph); ctx.stroke();
    }
    for (let y = 0; y <= Y_MAX; y++) {
      ctx.beginPath(); ctx.moveTo(mL, Y(y)); ctx.lineTo(mL + pw, Y(y)); ctx.stroke();
    }

    const { muA, sigmaA } = posterior();

    // raw product first (drawn underneath the curves)
    if (state.showProduct) {
      drawCurve(ctx, X, Y,
        (x) => gauss(x, state.muB, state.sigmaB) * gauss(x, state.y, state.sigmaO),
        cssVar("--series-product"), [5, 4]);
    }

    // posterior fill + curve (the answer), then prior & likelihood on top
    fillUnder(ctx, X, Y, (x) => gauss(x, muA, sigmaA), cssVar("--series-post"), 0.12);
    drawCurve(ctx, X, Y, (x) => gauss(x, muA, sigmaA), cssVar("--series-post"));
    drawCurve(ctx, X, Y, (x) => gauss(x, state.muB, state.sigmaB), cssVar("--series-prior"));
    drawCurve(ctx, X, Y, (x) => gauss(x, state.y, state.sigmaO), cssVar("--series-obs"));

    // dotted guide lines at the three means
    const means = [
      { mu: state.muB, color: "prior", text: "\u03bc_b" },
      { mu: state.y,   color: "obs",   text: "y" },
      { mu: muA,       color: "post",  text: "\u03bc_a" },
    ];
    for (const m of means) {
      ctx.strokeStyle = cssVar("--series-" + m.color);
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(m.mu), mT); ctx.lineTo(X(m.mu), mT + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    drawMeanLabels(ctx, X, Y, means);

    // axes
    ctx.strokeStyle = cssVar("--axis");
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mL, Y(0)); ctx.lineTo(mL + pw, Y(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + ph); ctx.stroke();

    // tick labels
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = cssVar("--ink-3");
    ctx.textAlign = "center";
    for (let x = -6; x <= 6; x += 2) ctx.fillText(String(x), X(x), Y(0) + 13);
    ctx.textAlign = "right";
    for (let y = 0; y <= 4; y++) ctx.fillText(String(y), mL - 5, Y(y) + 3);

    // axis titles
    ctx.fillStyle = cssVar("--ink-2");
    ctx.textAlign = "center";
    ctx.fillText("state x", mL + pw / 2, h - 4);
    ctx.save();
    ctx.translate(11, mT + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("pdf", 0, 0);
    ctx.restore();

    // readout
    const pB = 1 / (state.sigmaB * state.sigmaB);
    const pO = 1 / (state.sigmaO * state.sigmaO);
    $("bg-readout").innerHTML =
      `<div><strong>posterior</strong>  \u03bc_a = <strong>${fmt(muA)}</strong>,  \u03c3_a = <strong>${fmt(sigmaA)}</strong>` +
      ` &nbsp;\u00b7&nbsp; prior \u03bc_b = ${fmt(state.muB)}, \u03c3_b = ${fmt(state.sigmaB)}` +
      ` &nbsp;\u00b7&nbsp; obs y = ${fmt(state.y)}, \u03c3_o = ${fmt(state.sigmaO)}</div>` +
      `<div class="ro-formula">\u03bc_a = (${fmt(state.muB)}/${fmt(state.sigmaB)}\u00b2 + ${fmt(state.y)}/${fmt(state.sigmaO)}\u00b2)` +
      ` / (1/${fmt(state.sigmaB)}\u00b2 + 1/${fmt(state.sigmaO)}\u00b2) = ${fmt(muA)}</div>` +
      `<div class="ro-note">Posterior \u221d prior \u00d7 likelihood, rescaled to unit area \u2014 pulled toward the more certain (smaller \u03c3) input.</div>`;
  }

  // --------------------------------------------------------- interaction
  for (const [id, key, valId] of SLIDERS) {
    const el = $(id), valEl = $(valId);
    if (!el || !valEl) continue;
    const update = () => {
      state[key] = parseFloat(el.value);
      valEl.textContent = fmt(state[key]);
      render();
    };
    el.addEventListener("input", update);
    update();   // initial value labels
  }
  const productEl = $("bg-show-product");
  if (productEl) productEl.addEventListener("change", (e) => {
    state.showProduct = e.target.checked;
    render();
  });

  // ----------------------------------------------------------------- init
  window.addEventListener("resize", () => render());
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => render());
    ro.observe(root);
    ro.observe($("bg-plot"));
  }
  requestAnimationFrame(render);
  if (document.readyState !== "complete") addEventListener("load", render);
  setTheme(theme);   // sets data-theme + first render
})();
