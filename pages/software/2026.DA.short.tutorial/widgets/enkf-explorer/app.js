/* Ensemble Kalman Filter Explorer — Ch. 3.
   The same synthetic experiment as Ch. 2 (same ensemble, same observation)
   now goes through the analysis step. The widget performs the stochastic
   EnKF update live in the browser:

       x_a^m = x_b^m + K (y^m − H x_b^m),   K = P_b Hᵀ / (H P_b Hᵀ + R),
       y^m = y + ε^m,   ε^m ~ N(0, R).

   The Kalman gain K is the ensemble covariance pattern — the same dipole
   seen in Ch. 2 — and with a single scalar observation it is one vector;
   no matrix is ever assembled. Each analysis member is the background
   member plus a linear combination of the ensemble perturbations.

   Panels:
   1. Background — truth field + every member's 4 K contour (before).
   2. Analysis  — truth field + every member's 4 K contour (after); the
      band tightens around the truth ring as the obs pulls the members.
   3. Scatter — obs-space (x) vs state-at-marker (y): background points,
      analysis points, the obs value ± σ_o band, and the selected member's
      update arrow (before → after).

   Controls: member slider, obs-error σ_o slider (sets the pull strength),
   and the state marker (click/drag any map).

   Data: window.NEDAS_DATA (same data as Ch. 2 + obs_z, see
   build_enkf_data.py).
*/
(function () {
  "use strict";

  const D = window.NEDAS_DATA;
  if (!D) {
    document.body.innerHTML = "<p style='font:1rem sans-serif;padding:2rem'>" +
      "No data found. Run <code>python build_enkf_data.py</code> to create <code>data.js</code>.</p>";
    return;
  }

  const $ = (id) => document.getElementById(id);
  const nx = D.meta.nx, ny = D.meta.ny, nens = D.meta.nens;
  const xM = D.x, yM = D.y;                  // grid cell centers, m
  const truthT = D.truth.T;                  // [j][i]
  const ensT = D.ens.T;                      // [j][i][m]  (background)
  const obs = D.obs;                         // {i,j,x,y,val}
  const obsZ = D.obs_z;                      // [m] unit normals, obs perturbation
  const kx = nx - 1, ky = ny - 1;
  const LKM = D.meta.Lx / 1e3;             // domain width, km
  const LEVEL = 4.0;                       // contour level, K
  const io = obs.i, jo = obs.j;            // observation grid cell
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ------------------------------------------------------------- theme
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  const root = document.getElementById("enkf-explorer") ||
    document.querySelector(".da-widget") || document.documentElement;
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

  // ------------------------------------------- sequential truth LUT
  // YlOrRd in light mode, bright thermal in dark mode — same as the other
  // truth maps in the tutorial
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

  // ----------------------------------------------------------- ranges
  let vmax = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      vmax = Math.max(vmax, Math.abs(truthT[j][i]));
  vmax = Math.ceil(vmax);

  // scatter axes: zoomed on the ensemble cloud — every state and observation
  // value lies in [0, ~10] K (the truth blob peaks at ~7.9 K and the analysis
  // can overshoot slightly), so the fixed window [-2, 10] keeps the axes
  // stable while the sliders move
  const AX_LO = -2, AX_HI = 10;
  const AX_TICKS = [0, 2, 4, 6, 8, 10];

  // ----------------------------------------------------------- state
  let si = 33, sj = 18;                  // (i, j) of the state marker
  let sel = 49;                          // selected member, 0-based (default #50)
  let sigO = 1.0;                        // obs error std, K (slider)

  // ------------------------------------------------ EnKF statistics
  // scalar observation of T at (io, jo); H x_b^m = T_b at that cell.
  const hxb = new Float64Array(nens);
  for (let m = 0; m < nens; m++) hxb[m] = ensT[jo][io][m];
  let hxbMean = 0;
  for (let m = 0; m < nens; m++) hxbMean += hxb[m];
  hxbMean /= nens;
  let varB = 0;                            // H P_b Hᵀ, obs-space variance
  for (let m = 0; m < nens; m++) { const d = hxb[m] - hxbMean; varB += d * d; }
  varB /= (nens - 1);
  // ensemble mean field and P_b Hᵀ (the covariance of every grid cell with
  // the simulated observation) — flat, index c = j*nx+i
  const meanF = new Float64Array(nx * ny);
  const covF = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      let s = 0;
      for (let m = 0; m < nens; m++) s += ensT[j][i][m];
      meanF[c] = s / nens;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      let s = 0;
      for (let m = 0; m < nens; m++) s += (ensT[j][i][m] - meanF[c]) * (hxb[m] - hxbMean);
      covF[c] = s / (nens - 1);
    }
  }
  let meanZ = 0;
  for (let m = 0; m < nens; m++) meanZ += obsZ[m];
  meanZ /= nens;

  // ------------------------------------------------ marching squares
  // segments of the LEVEL contour of a flat field (value at j*nx+i), in
  // normalised map coordinates
  function contourSegs(field) {
    const segs = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v = [field[j * nx + i] - LEVEL, field[j * nx + i + 1] - LEVEL,
                   field[(j + 1) * nx + i + 1] - LEVEL, field[(j + 1) * nx + i] - LEVEL];
        let mask = 0;
        for (let k = 0; k < 4; k++) if (v[k] >= 0) mask |= 1 << k;
        if (mask === 0 || mask === 15) continue;
        const X = [i, i + 1, i + 1, i], Y = [j, j, j + 1, j + 1];
        const pt = (a, b) => {
          const t = v[a] / (v[a] - v[b]);
          return [(X[a] + (X[b] - X[a]) * t) / nx, (Y[a] + (Y[b] - Y[a]) * t) / ny];
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

  // ---- precompute the truth's and every background member's 4 K contour
  const truthSegs = contourSegs((() => {
    const f = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = truthT[j][i];
    return f;
  })());
  const bgSegs = new Array(nens);
  const bgCentres = new Float64Array(nens * 2);   // normalised 0..1
  {
    const f = new Float64Array(nx * ny);
    for (let m = 0; m < nens; m++) {
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = ensT[j][i][m];
      const segs = contourSegs(f);
      bgSegs[m] = segs;
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < segs.length; k++) { sx += segs[k][0] + segs[k][2]; sy += segs[k][1] + segs[k][3]; n += 2; }
      bgCentres[2 * m] = sx / n;
      bgCentres[2 * m + 1] = sy / n;
    }
  }

  // ---- analysis contours: recomputed only when σ_o changes (cache keyed
  // by the slider value; member/marker moves just redraw from the cache)
  let anCache = null;
  function getAnContours() {
    if (anCache && Math.abs(anCache.sig - sigO) < 1e-12) return anCache;
    const R = sigO * sigO, denom = varB + R, sq = Math.sqrt(R);
    const segs = new Array(nens);
    const centres = new Float64Array(nens * 2);
    const anf = new Float64Array(nx * ny);
    for (let m = 0; m < nens; m++) {
      const inc = obs.val + obsZ[m] * sq - hxb[m];
      const gain = inc / denom;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) anf[j * nx + i] = ensT[j][i][m] + covF[j * nx + i] * gain;
      }
      const s = contourSegs(anf);
      segs[m] = s;
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < s.length; k++) { sx += s[k][0] + s[k][2]; sy += s[k][1] + s[k][3]; n += 2; }
      centres[2 * m] = n ? sx / n : 0.5;
      centres[2 * m + 1] = n ? sy / n : 0.5;
    }
    anCache = { sig: sigO, segs, centres };
    return anCache;
  }

  // member palette (Tab20-style cycle, same as the rankine / Ch. 2 widgets)
  const MEM_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  const memColor = (m) => MEM_COLORS[m % MEM_COLORS.length];

  // ------------------------------------------------------ canvas utils
  function drawSegs(ctx, W, H, segs, stroke, lw, alpha) {
    if (!segs.length) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let k = 0; k < segs.length; k++) {
      ctx.moveTo(segs[k][0] * W, segs[k][1] * H);
      ctx.lineTo(segs[k][2] * W, segs[k][3] * H);
    }
    ctx.stroke();
    ctx.restore();
  }

  const ctxNullWarned = new Set();
  function warnCtxNull(id) {
    if (!ctxNullWarned.has(id)) {
      ctxNullWarned.add(id);
      console.warn(`[enkf-explorer] canvas "${id}" has no 2d context ` +
        "(device canvas memory limit?) — skipping draw until it recovers");
    }
  }

  function fitCanvas(cv) {
    const rect = cv.getBoundingClientRect();
    if (!(rect.width > 0.5) || !(rect.height > 0.5)) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    if (!ctx) {
      warnCtxNull(cv.id);
      return null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  function drawField(ctx, W, H, field, lo, hi, lutArr) {
    const off = document.createElement("canvas");
    off.width = nx; off.height = ny;
    const octx = off.getContext("2d");
    const img = octx.createImageData(nx, ny);
    const data = img.data;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const t = clamp((field[j][i] - lo) / (hi - lo || 1), 0, 1);
        const c = lutArr[Math.round(t * 255)];
        const p = (j * nx + i) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, W, H);
  }

  function px(i) { return (i + 0.5) / nx; }   // normalised 0..1
  function py(j) { return (j + 0.5) / ny; }

  function drawMarkers(ctx, W, H) {
    const cx = cssVar("--accent-fill");
    const ox = px(obs.i) * W, oy = py(obs.j) * H;
    ctx.beginPath();
    ctx.arc(ox, oy, 7, 0, Math.PI * 2);
    ctx.fillStyle = cx; ctx.fill();
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = cssVar("--series-red");
    ctx.stroke();
    const sx = px(si) * W, sy = py(sj) * H, s = 6;
    ctx.fillStyle = cx;
    ctx.fillRect(sx - s, sy - s, s * 2, s * 2);
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = cssVar("--series-ink");
    ctx.strokeRect(sx - s, sy - s, s * 2, s * 2);
  }

  function drawMapAxis(ctx, W, H) {
    const ink = cssVar("--ink-3");
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = ink;
    const cticks = [5, 15, 25, 35, 45];
    for (const c of cticks) {
      const xpos = px(c) * W;
      ctx.beginPath();
      ctx.moveTo(xpos, H - 1); ctx.lineTo(xpos, H - 4);
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
      const lab = Math.round((xM[c] - D.meta.Lx / 2) / 1e3);
      ctx.textAlign = "center";
      ctx.fillText(lab, xpos, H - 6);
      const ypos = py(c) * H;
      ctx.beginPath();
      ctx.moveTo(0, ypos); ctx.lineTo(4, ypos);
      ctx.strokeStyle = ink; ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(Math.round((yM[c] - D.meta.Ly / 2) / 1e3), 6, ypos + 3);
    }
  }

  function drawColorbar(cv, lo, hi) {
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { ctx, w, h } = fit;
    for (let k = 0; k < w; k++) {
      const c = lutTh[Math.max(0, Math.min(255, Math.round((k / (w - 1)) * 255)))];
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(k, 0, 1, h);
    }
    const lbl = cv.parentElement.querySelector(".cb-labels");
    if (lbl) {
      const f = (x) => (Math.abs(x) < 1e-9 ? "0" : x.toFixed(0)) + " K";
      lbl.querySelector(".cb-min").textContent = f(lo);
      lbl.querySelector(".cb-mid").textContent = f((lo + hi) / 2);
      lbl.querySelector(".cb-max").textContent = f(hi);
    }
  }

  // ------------------------------------------------------------ scatter
  function drawScatter(cv) {
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { ctx, w, h } = fit;
    const mL = 42, mR = 12, mT = 10, mB = 30;
    const pw = w - mL - mR, ph = h - mT - mB;
    const X = (v) => mL + ((v - AX_LO) / (AX_HI - AX_LO)) * pw;
    const Y = (v) => mT + ((AX_HI - v) / (AX_HI - AX_LO)) * ph;

    // axes + grid
    ctx.strokeStyle = cssVar("--line");
    ctx.lineWidth = 1;
    for (const t of AX_TICKS) {
      ctx.beginPath(); ctx.moveTo(X(t), mT); ctx.lineTo(X(t), mT + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mL, Y(t)); ctx.lineTo(mL + pw, Y(t)); ctx.stroke();
    }
    ctx.strokeStyle = cssVar("--axis");
    ctx.strokeRect(mL, mT, pw, ph);

    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = cssVar("--ink-3");
    ctx.textAlign = "center";
    for (const t of AX_TICKS) ctx.fillText(t, X(t), mT + ph + 12);
    ctx.textAlign = "right";
    for (const t of AX_TICKS) ctx.fillText(t, mL - 5, Y(t) + 3);
    ctx.textAlign = "center";
    ctx.fillStyle = cssVar("--ink-2");
    ctx.fillText(`Obs-space T (K)`, mL + pw / 2, h - 6);
    ctx.save();
    ctx.translate(12, mT + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`State T at (i, j) (K)`, 0, 0);
    ctx.restore();

    // EnKF numbers for this σ_o
    const R = sigO * sigO, denom = varB + R, sq = Math.sqrt(R);
    const Kobs = varB / denom;                     // gain at the obs cell
    const Kcell = covF[sj * nx + si] / denom;      // gain at the marker

    // obs value ± σ_o band (amber)
    ctx.fillStyle = cssVar("--series-amber");
    ctx.globalAlpha = 0.16;
    ctx.fillRect(X(obs.val - sq), mT, X(obs.val + sq) - X(obs.val - sq), ph);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar("--series-amber");
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(X(obs.val), mT);
    ctx.lineTo(X(obs.val), mT + ph);
    ctx.stroke();
    // ± σ_o whiskers
    ctx.lineWidth = 1;
    for (const v of [obs.val - sq, obs.val + sq]) {
      ctx.beginPath();
      ctx.moveTo(X(v), mT + 4); ctx.lineTo(X(v), mT + ph - 4);
      ctx.stroke();
    }

    // truth value at the marker (ink)
    ctx.strokeStyle = cssVar("--series-ink");
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(mL, Y(truthT[sj][si]));
    ctx.lineTo(mL + pw, Y(truthT[sj][si]));
    ctx.stroke();

    // background points (aqua)
    ctx.fillStyle = cssVar("--series-aqua");
    for (let m = 0; m < nens; m++) {
      const x = X(hxb[m]), y = Y(ensT[sj][si][m]);
      if (!isFinite(x) || !isFinite(y)) continue;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // analysis points (red)
    ctx.fillStyle = cssVar("--series-red");
    for (let m = 0; m < nens; m++) {
      const inc = obs.val + obsZ[m] * sq - hxb[m];
      const x = X(hxb[m] + Kobs * inc), y = Y(ensT[sj][si][m] + Kcell * inc);
      if (!isFinite(x) || !isFinite(y)) continue;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // selected member: update arrow + endpoint rings
    const incSel = obs.val + obsZ[sel] * sq - hxb[sel];
    const xb = X(hxb[sel]), yb = Y(ensT[sj][si][sel]);
    const xa = X(hxb[sel] + Kobs * incSel), ya = Y(ensT[sj][si][sel] + Kcell * incSel);
    if (isFinite(xb) && isFinite(yb) && isFinite(xa) && isFinite(ya)) {
      ctx.strokeStyle = memColor(sel);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xb, yb);
      ctx.lineTo(xa, ya);
      ctx.stroke();
      const ang = Math.atan2(ya - yb, xa - xb), hl = 9;
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xa - hl * Math.cos(ang - 0.42), ya - hl * Math.sin(ang - 0.42));
      ctx.moveTo(xa, ya);
      ctx.lineTo(xa - hl * Math.cos(ang + 0.42), ya - hl * Math.sin(ang + 0.42));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(xb, yb, 4, 0, Math.PI * 2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = memColor(sel);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(xa, ya, 4, 0, Math.PI * 2);
      ctx.fillStyle = memColor(sel);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------- render
  function render() {
    const th2 = makeLUT(LUT_THERMAL[theme]);
    lutTh.splice(0, lutTh.length, ...th2);

    const an = getAnContours();
    drawEnsMap($("map-bg"), bgSegs, bgCentres, 0.45, false);
    drawEnsMap($("map-an"), an.segs, an.centres, 0.7, true);
    drawColorbar($("cb-bg"), 0, vmax);
    drawColorbar($("cb-an"), 0, vmax);
    drawScatter($("scat"));

    // readout
    const sgn = (x) => (Math.abs(x) < 0.5 ? "0" : (x > 0 ? "+" : "\u2212") + Math.abs(x).toFixed(0));
    const R = sigO * sigO, denom = varB + R, sq = Math.sqrt(R);
    const Kobs = varB / denom;
    const incSel = obs.val + obsZ[sel] * sq - hxb[sel];
    const dT = (covF[sj * nx + si] / denom) * incSel;
    const dxBg = (bgCentres[2 * sel] - 0.5) * LKM, dyBg = (bgCentres[2 * sel + 1] - 0.5) * LKM;
    const dxAn = (an.centres[2 * sel] - 0.5) * LKM, dyAn = (an.centres[2 * sel + 1] - 0.5) * LKM;
    $("readout").innerHTML =
      `State <strong>(i, j) = (${si}, ${sj})</strong> · ` +
      `truth T = <strong>${truthT[sj][si].toFixed(1)}</strong> K<br>` +
      `member <strong>${sel + 1}</strong> · bg centre <strong>(${sgn(dxBg)}, ${sgn(dyBg)}) km</strong> ` +
      `&rarr; an centre <strong>(${sgn(dxAn)}, ${sgn(dyAn)}) km</strong> · ` +
      `&Delta;T at (i, j) = <strong>${dT >= 0 ? "+" : "\u2212"}${Math.abs(dT).toFixed(1)}</strong> K<br>` +
      `&sigma;<sub>o</sub> = <strong>${sigO.toFixed(2)}</strong> K · ` +
      `gain at obs K = <strong>${Kobs.toFixed(2)}</strong> · ` +
      `obs-space spread ${Math.sqrt(varB).toFixed(2)} &rarr; <strong>${Math.sqrt(varB * R / denom).toFixed(2)}</strong> K`;
  }

  // ensemble map: truth field + member 4 K contours (+ selected member +
  // centre dot + optional displacement line) + truth ring + markers + axis
  function drawEnsMap(cv, segs, centres, dim, isAn) {
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { ctx, w, h } = fit;
    drawField(ctx, w, h, truthT, 0, vmax, lutTh);
    for (let m = 0; m < nens; m++) {
      if (m === sel) continue;
      drawSegs(ctx, w, h, segs[m], memColor(m), 1, dim);
    }
    drawSegs(ctx, w, h, segs[sel], memColor(sel), 2.4, 1);
    const cxm = centres[2 * sel] * w, cym = centres[2 * sel + 1] * h;
    if (isAn && bgSegs[sel].length && segs[sel].length) {
      // displacement line: where the selected member's centre came from
      const bx = bgCentres[2 * sel] * w, by = bgCentres[2 * sel + 1] * h;
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = memColor(sel);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(cxm, cym);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fillStyle = memColor(sel);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cxm, cym, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = cssVar("--accent-fill");
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = memColor(sel);
    ctx.stroke();
    // truth 4 K contour: halo + ink core so it reads on every colour
    drawSegs(ctx, w, h, truthSegs, theme === "dark" ? "#241439" : "#ffffff", 3.4, 0.95);
    drawSegs(ctx, w, h, truthSegs, cssVar("--series-ink"), 1.6, 1);
    drawMarkers(ctx, w, h);
    drawMapAxis(ctx, w, h);
  }

  // --------------------------------------------------------- interaction
  function mapPosToIJ(cv, clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    const fx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const fy = clamp((clientY - rect.top) / rect.height, 0, 1);
    return { i: Math.floor(fx * nx), j: Math.floor(fy * ny) };
  }

  function setMarker(i, j, doRender) {
    si = clamp(Math.round(i), 0, kx);
    sj = clamp(Math.round(j), 0, ky);
    if (doRender !== false) render();
  }

  for (const id of ["map-bg", "map-an"]) {
    const cv = $(id);
    let dragging = false;
    const move = (e) => {
      const { i, j } = mapPosToIJ(cv, e.clientX, e.clientY);
      if (dragging || e.type === "click") setMarker(i, j, true);
    };
    cv.addEventListener("pointerdown", (e) => {
      dragging = true;
      move(e);
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* touch on some iOS versions */ }
    });
    cv.addEventListener("pointermove", (e) => { if (dragging) move(e); });
    cv.addEventListener("pointerup", () => { dragging = false; hideTooltip(); });
    cv.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    cv.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const { i, j } = mapPosToIJ(cv, e.clientX, e.clientY);
      showTooltip(e.clientX, e.clientY, i, j);
    });
    cv.addEventListener("pointerleave", hideTooltip);
  }

  let tip = document.createElement("div");
  tip.id = "tooltip";
  (root || document.body).appendChild(tip);
  function showTooltip(cx, cy, i, j) {
    const c = j * nx + i;
    const R = sigO * sigO, denom = varB + R;
    const anMean = meanF[c] + covF[c] * (obs.val - hxbMean + meanZ * Math.sqrt(R)) / denom;
    tip.innerHTML =
      `<strong>(${i}, ${j})</strong>` +
      ` · T = ${truthT[j][i].toFixed(2)} K` +
      ` · mean bg = ${meanF[c].toFixed(2)}` +
      ` · mean an = ${anMean.toFixed(2)} K`;
    tip.style.display = "block";
    const pad = 14;
    let lx = cx + pad, ly = cy + pad;
    if (lx + 260 > window.innerWidth) lx = cx - 280;
    if (ly + 30 > window.innerHeight) ly = cy - 40;
    tip.style.left = lx + "px";
    tip.style.top = ly + "px";
  }
  function hideTooltip() { tip.style.display = "none"; }

  // ----------------------------------------------------------------- init
  const memEl = $("mem-slider"), memVal = $("mem-val");
  if (memEl) {
    memEl.value = sel + 1;
    memEl.addEventListener("input", () => {
      sel = clamp(parseInt(memEl.value, 10) || 1, 1, nens) - 1;
      memVal.textContent = sel + 1;
      render();
    });
  }
  const sigEl = $("sig-o"), sigVal = $("sig-o-val");
  if (sigEl) {
    sigEl.value = sigO;
    sigEl.addEventListener("input", () => {
      sigO = clamp(parseFloat(sigEl.value) || 1, 0.2, 4);
      sigVal.textContent = sigO.toFixed(2);
      render();
    });
  }

  window.addEventListener("resize", () => render());
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => render());
    ro.observe(root);
    for (const id of ["map-bg", "map-an", "scat"]) ro.observe($(id));
  }
  requestAnimationFrame(render);
  if (document.readyState !== "complete") addEventListener("load", render);
  setTheme(theme);   // sets data-theme + first render
})();
