/* Bivariate Gaussian — "Uncertainty and error covariance" (Chapter 2 widget).

   Bayes' rule for two variables, with one of them observed. The prior is a
   bivariate Gaussian N(μ_b, Σ_b); the observation constrains y with error
   σ_o. The posterior is again a bivariate Gaussian, computed in information
   form:

       Λ_b = Σ_b⁻¹,   b_b = Λ_b μ_b
       Λ_a = Λ_b + Hᵀ R⁻¹ H,   H = [0 1],   R = σ_o²
       Σ_a = Λ_a⁻¹,   μ_a = Σ_a ( b_b + [0, y_obs/σ_o²] )

   The main panel draws the joint pdf as covariance ellipses (1σ, 2σ, 3σ)
   for the prior and the posterior, plus the observation band; the side
   panels draw the marginal pdfs of x and y. Observing y also sharpens x —
   purely through the prior correlation ρ.

   Embedding-ready copy (see series README): the widget root is
   document.querySelector(".da-widget") (falls back to the document root
   for standalone use), the theme follows prefers-color-scheme via the
   data-theme attribute, and a ResizeObserver re-renders when the site
   page reflows the widget.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.getElementById("bivariate-gaussian") || document.querySelector(".da-widget") || document.documentElement;

  // ------------------------------------------------------------- theme
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

  // -------------------------------------------------------------- state
  // [slider id, state key, value-span id]
  const SLIDERS = [
    ["b2-mu-x",     "muX",    "b2-mu-x-val"],
    ["b2-mu-y",     "muY",    "b2-mu-y-val"],
    ["b2-sig-x",    "sigmaX", "b2-sig-x-val"],
    ["b2-sig-y",    "sigmaY", "b2-sig-y-val"],
    ["b2-rho",      "rho",    "b2-rho-val"],
    ["b2-obs-y",    "obsY",   "b2-obs-y-val"],
    ["b2-obs-sigma","sigmaO", "b2-obs-sigma-val"],
  ];
  const state = { muX: 0, muY: 0, sigmaX: 1.2, sigmaY: 1.2, rho: 0.6, obsY: 0.8, sigmaO: 0.4 };
  const fmt = (v) => (Math.abs(v) < 1e-9 ? "0.00" : v.toFixed(2));

  // --------------------------------------------------------------- math
  // inverse of [[a,b],[c,d]]
  function inv2(a, b, c, d) {
    const det = a * d - b * c;
    return [[d / det, -b / det], [-c / det, a / det]];
  }
  function mul2v(M, v) {
    return [M[0][0] * v[0] + M[0][1] * v[1], M[1][0] * v[0] + M[1][1] * v[1]];
  }
  function gauss(x, mu, sigma) {
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
  }
  function posterior() {
    const sxx = state.sigmaX * state.sigmaX, syy = state.sigmaY * state.sigmaY;
    const sxy = state.rho * state.sigmaX * state.sigmaY;
    const LamB = inv2(sxx, sxy, sxy, syy);
    const bB = mul2v(LamB, [state.muX, state.muY]);
    const R = state.sigmaO * state.sigmaO;
    const LamA = [[LamB[0][0], LamB[0][1]], [LamB[1][0], LamB[1][1] + 1 / R]];
    const SigA = inv2(LamA[0][0], LamA[0][1], LamA[1][0], LamA[1][1]);
    const muA = mul2v(SigA, [bB[0], bB[1] + state.obsY / R]);
    const sxA = Math.sqrt(SigA[0][0]), syA = Math.sqrt(SigA[1][1]);
    return { muA, sxA, syA, rhoA: SigA[0][1] / (sxA * syA || 1) };
  }

  // -------------------------------------------------------- plot domain
  const R_MIN = -6, R_MAX = 6, PDF_MAX = 2.2;

  // -------------------------------------------------- canvas plumbing
  const ctxNullWarned = new Set();
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
      if (!ctxNullWarned.has(cv.id)) {
        ctxNullWarned.add(cv.id);
        console.warn(`[bivariate-gaussian] canvas "${cv.id}" has no 2d context — skipping draw`);
      }
      return null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  // horizontal marginal curve: x ∈ [R_MIN, R_MAX], pdf on the vertical axis
  function strokeH(ctx, X, Y, f, color, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= 200; k++) {
      const x = R_MIN + (k / 200) * (R_MAX - R_MIN);
      const p = Math.max(0, Math.min(PDF_MAX, f(x)));
      if (first) { ctx.moveTo(X(x), Y(p)); first = false; } else ctx.lineTo(X(x), Y(p));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function fillH(ctx, X, Y, f, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= 200; k++) {
      const x = R_MIN + (k / 200) * (R_MAX - R_MIN);
      const p = Math.max(0, Math.min(PDF_MAX, f(x)));
      if (first) { ctx.moveTo(X(x), Y(p)); first = false; } else ctx.lineTo(X(x), Y(p));
    }
    ctx.lineTo(X(R_MAX), Y(0));
    ctx.lineTo(X(R_MIN), Y(0));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // vertical marginal curve: y ∈ [R_MIN, R_MAX], pdf on the horizontal axis
  function strokeV(ctx, X, Y, f, color, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= 200; k++) {
      const y = R_MIN + (k / 200) * (R_MAX - R_MIN);
      const p = Math.max(0, Math.min(PDF_MAX, f(y)));
      if (first) { ctx.moveTo(X(p), Y(y)); first = false; } else ctx.lineTo(X(p), Y(y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function fillV(ctx, X, Y, f, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= 200; k++) {
      const y = R_MIN + (k / 200) * (R_MAX - R_MIN);
      const p = Math.max(0, Math.min(PDF_MAX, f(y)));
      if (first) { ctx.moveTo(X(p), Y(y)); first = false; } else ctx.lineTo(X(p), Y(y));
    }
    ctx.lineTo(X(0), Y(R_MAX));
    ctx.lineTo(X(0), Y(R_MIN));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // kσ covariance ellipse of N(μ, Σ) with stds sx, sy and correlation rho
  function drawEllipse(ctx, X, Y, mu, sx, sy, rho, k) {
    const a = sx * sx, b = rho * sx * sy, c = sy * sy;
    const tr = a + c;
    const disc = Math.sqrt((a - c) * (a - c) + 4 * b * b);
    const lam1 = (tr + disc) / 2, lam2 = (tr - disc) / 2;
    const theta = 0.5 * Math.atan2(2 * b, a - c);
    const ct = Math.cos(theta), st = Math.sin(theta);
    ctx.beginPath();
    for (let t = 0; t <= 2 * Math.PI + 0.02; t += 0.04) {
      const dx = k * Math.sqrt(lam1) * Math.cos(t) * ct - k * Math.sqrt(lam2) * Math.sin(t) * st;
      const dy = k * Math.sqrt(lam1) * Math.cos(t) * st + k * Math.sqrt(lam2) * Math.sin(t) * ct;
      const px = X(mu[0] + dx), py = Y(mu[1] + dy);
      if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // ------------------------------------------------------------- render
  function render() {
    const fit = fitCanvas($("b2-joint"));
    if (!fit) return;
    const { ctx, w, h } = fit;

    const mL = 34, mR = 10, mT = 14, mB = 46;
    const pw = w - mL - mR, ph = h - mT - mB;
    const X = (x) => mL + ((x - R_MIN) / (R_MAX - R_MIN)) * pw;
    const Y = (y) => mT + (1 - (y - R_MIN) / (R_MAX - R_MIN)) * ph;

    const post = posterior();

    // grid
    ctx.strokeStyle = cssVar("--line");
    ctx.lineWidth = 1;
    for (let v = R_MIN; v <= R_MAX; v++) {
      ctx.beginPath(); ctx.moveTo(X(v), mT); ctx.lineTo(X(v), mT + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mL, Y(v)); ctx.lineTo(mL + pw, Y(v)); ctx.stroke();
    }

    // observation band: constrains y to [y_obs − σ_o, y_obs + σ_o]
    const oy0 = Y(state.obsY - state.sigmaO), oy1 = Y(state.obsY + state.sigmaO);
    ctx.fillStyle = cssVar("--series-obs");
    ctx.globalAlpha = 0.14;
    ctx.fillRect(X(R_MIN), oy1, pw, Math.max(0, oy0 - oy1));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar("--series-obs");
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(R_MIN), Y(state.obsY)); ctx.lineTo(X(R_MAX), Y(state.obsY)); ctx.stroke();

    // prior ellipses (dashed)
    ctx.setLineDash([5, 4]);
    for (const k of [1, 2, 3]) {
      drawEllipse(ctx, X, Y, [state.muX, state.muY], state.sigmaX, state.sigmaY, state.rho, k);
      ctx.strokeStyle = cssVar("--series-prior");
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // posterior: 1σ translucent fill, then 1σ, 2σ, 3σ ellipses
    drawEllipse(ctx, X, Y, post.muA, post.sxA, post.syA, post.rhoA, 1);
    ctx.fillStyle = cssVar("--series-post");
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
    for (const k of [1, 2, 3]) {
      drawEllipse(ctx, X, Y, post.muA, post.sxA, post.syA, post.rhoA, k);
      ctx.strokeStyle = cssVar("--series-post");
      ctx.lineWidth = 1.75;
      ctx.stroke();
    }

    // means
    ctx.fillStyle = cssVar("--series-prior");
    ctx.beginPath(); ctx.arc(X(state.muX), Y(state.muY), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cssVar("--series-post");
    ctx.beginPath(); ctx.arc(X(post.muA[0]), Y(post.muA[1]), 3.5, 0, Math.PI * 2); ctx.fill();

    // axes
    ctx.strokeStyle = cssVar("--axis");
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mL, Y(0)); ctx.lineTo(mL + pw, Y(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + ph); ctx.stroke();

    // tick labels
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = cssVar("--ink-3");
    ctx.textAlign = "center";
    for (let v = -6; v <= 6; v += 2) ctx.fillText(String(v), X(v), Y(0) + 13);
    ctx.textAlign = "right";
    for (let v = -6; v <= 6; v += 2) ctx.fillText(String(v), mL - 5, Y(v) + 3);

    // axis titles
    ctx.fillStyle = cssVar("--ink-2");
    ctx.textAlign = "center";
    ctx.fillText("x", mL + pw / 2, h - 4);
    ctx.save();
    ctx.translate(11, mT + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("y", 0, 0);
    ctx.restore();

    // marginals
    drawMargX(post);
    drawMargY(post);

    // readout
    $("b2-readout").innerHTML =
      `<div><strong>posterior</strong>  \u03bcx = <strong>${fmt(post.muA[0])}</strong>, \u03c3x = <strong>${fmt(post.sxA)}</strong>` +
      ` \u00b7 \u03bcy = <strong>${fmt(post.muA[1])}</strong>, \u03c3y = <strong>${fmt(post.syA)}</strong>` +
      ` \u00b7 \u03c1 = <strong>${fmt(post.rhoA)}</strong></div>` +
      `<div class="ro-note">prior: \u03bcx = ${fmt(state.muX)}, \u03bcy = ${fmt(state.muY)}, \u03c3x = ${fmt(state.sigmaX)}, ` +
      `\u03c3y = ${fmt(state.sigmaY)}, \u03c1 = ${fmt(state.rho)}  \u00b7  obs: y = ${fmt(state.obsY)}, \u03c3 = ${fmt(state.sigmaO)}</div>` +
      `<div class="ro-note">y is observed, yet x sharpens too (\u03c3x ${fmt(state.sigmaX)} \u2192 ${fmt(post.sxA)}) — the prior correlation \u03c1 ` +
      `carries information from the observed variable to the unobserved one.</div>`;
  }

  // x marginal (top panel, shares the x-axis with the joint plot)
  function drawMargX(post) {
    const fit = fitCanvas($("b2-margx"));
    if (!fit) return;
    const { ctx, w, h } = fit;
    const mL = 34, mR = 10, mT = 4, mB = 6;   // left margin aligns with joint
    const pw = w - mL - mR, ph = h - mT - mB;
    const X = (x) => mL + ((x - R_MIN) / (R_MAX - R_MIN)) * pw;
    const Y = (p) => mT + (1 - p / PDF_MAX) * ph;
    fillH(ctx, X, Y, (x) => gauss(x, post.muA[0], post.sxA), cssVar("--series-post"), 0.12);
    strokeH(ctx, X, Y, (x) => gauss(x, state.muX, state.sigmaX), cssVar("--series-prior"), [5, 4]);
    strokeH(ctx, X, Y, (x) => gauss(x, post.muA[0], post.sxA), cssVar("--series-post"));
    ctx.strokeStyle = cssVar("--axis");
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mL, Y(0)); ctx.lineTo(mL + pw, Y(0)); ctx.stroke();
  }

  // y marginal (right panel, shares the y-axis with the joint plot)
  function drawMargY(post) {
    const fit = fitCanvas($("b2-margy"));
    if (!fit) return;
    const { ctx, w, h } = fit;
    const mL = 6, mR = 4, mT = 14, mB = 46;   // vertical range aligns with joint
    const pw = w - mL - mR, ph = h - mT - mB;
    const X = (p) => mL + (p / PDF_MAX) * pw;
    const Y = (y) => mT + (1 - (y - R_MIN) / (R_MAX - R_MIN)) * ph;
    fillV(ctx, X, Y, (y) => gauss(y, post.muA[1], post.syA), cssVar("--series-post"), 0.12);
    strokeV(ctx, X, Y, (y) => gauss(y, state.muY, state.sigmaY), cssVar("--series-prior"), [5, 4]);
    strokeV(ctx, X, Y, (y) => gauss(y, state.obsY, state.sigmaO), cssVar("--series-obs"));
    strokeV(ctx, X, Y, (y) => gauss(y, post.muA[1], post.syA), cssVar("--series-post"));
    ctx.strokeStyle = cssVar("--axis");
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mL, Y(R_MIN)); ctx.lineTo(mL, Y(R_MAX)); ctx.stroke();
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

  // ----------------------------------------------------------------- init
  window.addEventListener("resize", () => render());
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => render());
    ro.observe(root);
    for (const id of ["b2-joint", "b2-margx", "b2-margy"]) ro.observe($(id));
  }
  requestAnimationFrame(render);
  if (document.readyState !== "complete") addEventListener("load", render);
  setTheme(theme);   // sets data-theme + first render
})();
