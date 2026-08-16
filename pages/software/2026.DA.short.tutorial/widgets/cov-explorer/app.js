// © Yue Ying, CC BY 4.0 — https://myying.github.io/pages/software/2026.DA.short.tutorial/toc.html
/* Sample Covariance Explorer — Ch. 6 (Localization and inflation).
   Live counterpart of the Ch. 2 Observation–State Correlation Explorer,
   simplified and re-targeted at localization:

     · the truth is a compact Gaussian hump (radius scale 30 km) plus a
       smooth random background field (std 1.5 K, correlation ~40 km), so
       the covariance length scale is short;
     · the ensemble perturbs the hump position (std 25 km) and draws an
       independent smooth background per member — the sample covariance
       therefore has a short, dipole-like structure, and small ensembles
       fill the far field with spurious values;
     · three panels: truth | TRUE covariance (analytic) | sample covariance
       (raw or Gaspari–Cohn localized);
     · drag the observation anywhere on a map; sliders for ensemble size n
       and localization radius R; toggle for the localization kernel; a
       dashed circle marks the radius of influence.

   No data file needed: the 300-member pool (displaced hump + smooth random
   background per member) is generated once from a seeded RNG (mulberry32,
   seed 42). The n slider only reveals more members of that same pool, so
   the sample covariance converges smoothly and the sampling noise is
   reproducible. The true covariance is computed analytically: the exact
   covariance of a Gaussian hump under random Gaussian translation, plus the
   background covariance B^2 exp(-d^2/2L^2).
*/
(function () {
  "use strict";

  // ------------------------------------------------- synthetic experiment
  const NX = 50, NY = 50, DX = 10e3, DY = 10e3;
  const LX = NX * DX, LY = NY * DY;            // 500 km square domain
  const XC = LX / 2, YC = LY / 2;
  const A = 8.0, SH = 30e3;                    // hump: 8 K peak, 30 km radius
  const SP = 25e3;                             // hump position spread, m
  const B = 1.5, LBG = 40e3;                   // background: std 1.5 K, corr 40 km
  const BG_K = 2.9, BG_RAD = 6;                // background smoothing kernel
  const POOL = 300;                            // max ensemble members
  const NP = NX * NY;
  const A2 = A * A, B2 = B * B, LBG2 = LBG * LBG;
  const SH2 = SH * SH, SP2 = SP * SP;
  const E1DEN = SH2 + SP2;
  const E2DEN = 1 + 2 * SP2 / SH2;

  const xM = new Float64Array(NX), yM = new Float64Array(NY);
  for (let i = 0; i < NX; i++) xM[i] = (i + 0.5) * DX;
  for (let j = 0; j < NY; j++) yM[j] = (j + 0.5) * DY;

  // ---- seeded RNG (mulberry32) + Box–Muller normal
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const rng = mulberry32(42);
  const g = () => gauss(rng);

  // 1-D smoothing kernel (separable Gaussian, radius BG_RAD, std BG_K cells)
  const kern = new Float64Array(2 * BG_RAD + 1);
  {
    let s = 0;
    for (let k = -BG_RAD; k <= BG_RAD; k++) { const w = Math.exp(-(k * k) / (2 * BG_K * BG_K)); kern[k + BG_RAD] = w; s += w; }
    for (let k = 0; k < kern.length; k++) kern[k] /= s;
  }
  // smooth random background field. The noise is generated on a grid padded
  // by BG_RAD on every side and the centre NX x NY is cropped: every crop
  // point is then a full 13-tap average of genuinely independent noise, so
  // there are no edge artifacts (clamped borders would otherwise inflate the
  // corner variance and create extreme outliers). Rescaled to std B.
  const GB = BG_RAD, GNX = NX + 2 * GB, GNY = NY + 2 * GB, GNP = GNX * GNY;
  function smoothBg() {
    const f = new Float64Array(GNP);
    const tmp = new Float64Array(GNP);
    for (let p = 0; p < GNP; p++) f[p] = g();
    // x pass (border values are never used by the crop)
    for (let j = 0; j < GNY; j++) {
      for (let i = 0; i < GNX; i++) {
        let s = 0;
        for (let k = -GB; k <= GB; k++) {
          const ii = i + k;
          s += kern[k + GB] * f[j * GNX + (ii < 0 ? 0 : ii >= GNX ? GNX - 1 : ii)];
        }
        tmp[j * GNX + i] = s;
      }
    }
    // y pass
    for (let i = 0; i < GNX; i++) {
      for (let j = 0; j < GNY; j++) {
        let s = 0;
        for (let k = -GB; k <= GB; k++) {
          const jj = j + k;
          s += kern[k + GB] * tmp[(jj < 0 ? 0 : jj >= GNY ? GNY - 1 : jj) * GNX + i];
        }
        f[j * GNX + i] = s;
      }
    }
    // crop + rescale to std B
    let m = 0, sd = 0;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const v = f[(j + GB) * GNX + (i + GB)];
        m += v; sd += v * v;
        tmp[j * NX + i] = v;
      }
    }
    m /= NP;
    sd = Math.sqrt(sd / NP - m * m) || 1;
    for (let p = 0; p < NP; p++) tmp[p] = (tmp[p] - m) / sd * B;
    return tmp;
  }

  // ---- truth field: hump (at centre) + one background realization, offset
  // so the temperature stays positive (covariance is shift-invariant, so the
  // offset only affects the truth display and the readout)
  const truthT = new Float32Array(NP);
  {
    const bg = smoothBg();
    let mn = Infinity;
    for (let j = 0; j < NY; j++) {
      const dy = yM[j] - YC;
      for (let i = 0; i < NX; i++) {
        const dx = xM[i] - XC;
        truthT[j * NX + i] = A * Math.exp(-(dx * dx + dy * dy) / (2 * SH2)) + bg[j * NX + i];
        if (truthT[j * NX + i] < mn) mn = truthT[j * NX + i];
      }
    }
    const OFF = 1 - mn;                      // min becomes +1 K
    for (let p = 0; p < NP; p++) truthT[p] += OFF;
  }

  // ---- member pool: displaced hump + independent background
  const pool = new Float32Array(POOL * NP);
  for (let m = 0; m < POOL; m++) {
    const dxc = g() * SP, dyc = g() * SP;
    const bg = smoothBg();
    const b = m * NP;
    for (let j = 0; j < NY; j++) {
      const dy = yM[j] - (YC + dyc);
      for (let i = 0; i < NX; i++) {
        const dx = xM[i] - (XC + dxc);
        pool[b + j * NX + i] = A * Math.exp(-(dx * dx + dy * dy) / (2 * SH2)) + bg[j * NX + i];
      }
    }
  }

  // ------------------------------------------------------------- theme
  const $ = (id) => document.getElementById(id);

  // Follows the browser's light/dark preference (no manual toggle in the
  // embedded layout).
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  // when embedded in a site page the widget lives inside a .da-widget wrapper,
  // which carries the CSS custom properties and the data-theme attribute;
  // standalone (file://) it falls back to the document root.
  const root = document.querySelector(".da-widget") || document.documentElement;
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));

  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

  // ------------------------------------------- diverging colour ramp LUT
  // blue ↔ neutral ↔ red (dataviz diverging pair; midpoint = surface)
  const LUT_STOPS = {
    // light mode: ColorBrewer RdBu (diverging, colourblind-safe) — deep blue
    // → pale blue → white at 0 → pale red → deep red; the white midpoint
    // reads as the panel background, so “no covariance” is invisible
    light: [
      [-1.0, "#2166ac"], [-0.6, "#4393c3"], [-0.3, "#92c5de"], [-0.12, "#d1e5f0"],
      [0.0, "#f7f7f7"],
      [0.12, "#fddbc7"], [0.3, "#f4a582"], [0.6, "#d6604d"], [1.0, "#b2182b"],
    ],
    dark: [
      [-1.0, "#3987e5"], [-0.5, "#6da7ec"], [-0.15, "#454b61"],
      [0.0, "#383835"],
      [0.15, "#5b443d"], [0.5, "#e66767"], [1.0, "#b93636"],
    ],
  };

  // sequential “YlOrRd” ramp (ColorBrewer) for the truth field in light
  // mode — pale yellow (cold) → orange → deep red (warm); distinct from the
  // diverging covariance scale
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
  // generic 256-entry LUT; `map` maps the field fraction t (0..1) onto the
  // stops' domain: diverging uses v = 2t−1 (symmetric around 0), sequential
  // uses v = t (monotone positive)
  function makeLUT(stops, map) {
    const lut = new Array(256);
    for (let k = 0; k < 256; k++) {
      const v = map(k / 255);
      let s = 0;
      while (s < stops.length - 2 && v > stops[s + 1][0]) s++;
      const [v0, c0] = stops[s], [v1, c1] = stops[s + 1];
      const f = (v - v0) / (v1 - v0 || 1);
      const a = hex2rgb(c0), b = hex2rgb(c1);
      lut[k] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    return lut;
  }
  const divMap = (t) => t * 2 - 1;
  const seqMap = (t) => t;
  const lut = makeLUT(LUT_STOPS.light, divMap);       // diverging: covariance
  const lutTh = makeLUT(LUT_THERMAL.light, seqMap);   // sequential: truth

  // ----------------------------------------------------------- ranges
  // truth colorbar: 0..vmax (field is offset positive), rounded up to a whole K
  let vmax = 0;
  for (let p = 0; p < NP; p++) vmax = Math.max(vmax, truthT[p]);
  vmax = Math.ceil(vmax);

  // covariance colour range is FIXED at ±7 K² (the true peak at the default
  // observation is 6.96 K²): dragging the obs or changing n never rescales
  // the colourbar, so the maps stay directly comparable; sample values
  // beyond ±7 saturate the scale
  const COV_RANGE = 7.0;

  // ------------------------------------------------------------ state
  let oi = 28, oj = 22;        // observation (i, j) — on the hump's east flank
  let nens = 100;              // visible ensemble members (5..300)
  let R = 100e3;               // localization radius of influence, m
  let locOn = false;           // apply the Gaspari–Cohn kernel?
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ------------------------------------------------------ canvas utils
  const ctxNullWarned = new Set();
  function warnCtxNull(id) {
    if (!ctxNullWarned.has(id)) {
      ctxNullWarned.add(id);
      console.warn(`[cov-explorer] canvas "${id}" has no 2d context ` +
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
    off.width = NX; off.height = NY;
    const octx = off.getContext("2d");
    const img = octx.createImageData(NX, NY);
    const data = img.data;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const t = clamp((field[j * NX + i] - lo) / (hi - lo || 1), 0, 1);
        const c = lutArr[Math.round(t * 255)];
        const p = (j * NX + i) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, W, H);
  }

  function px(i) { return (i + 0.5) / NX; }   // normalised 0..1
  function py(j) { return (j + 0.5) / NY; }

  // localization radius-of-influence circle (dashed ring only — no fill, so
  // the field stays fully visible inside the localization distance)
  function drawCircle(ctx, W, H) {
    if (!locOn) return;
    const ox = px(oi) * W, oy = py(oj) * H;
    const rad = (R / LX) * W;          // square domain: LX == LY
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = cssVar("--series-amber");
    ctx.beginPath();
    ctx.arc(ox, oy, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }



  function drawObs(ctx, W, H) {
    const cx = cssVar("--accent-fill");
    const ox = px(oi) * W, oy = py(oj) * H;
    ctx.beginPath();
    ctx.arc(ox, oy, 8, 0, Math.PI * 2);
    ctx.fillStyle = cx; ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = cssVar("--series-red");
    ctx.stroke();
    // small crosshair hints that the observation is draggable
    ctx.strokeStyle = cssVar("--series-red");
    ctx.lineWidth = 1.4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(ox + dx * 11, oy + dy * 11);
      ctx.lineTo(ox + dx * 15, oy + dy * 15);
      ctx.stroke();
    }
  }

  // axis ticks on maps (km, centred on domain, like the Ch. 2 widget)
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
      const lab = Math.round((xM[c] - LX / 2) / 1e3);
      ctx.textAlign = "center";
      ctx.fillText(lab, xpos, H - 6);
      const ypos = py(c) * H;
      ctx.beginPath();
      ctx.moveTo(0, ypos); ctx.lineTo(4, ypos);
      ctx.strokeStyle = ink; ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(Math.round((yM[c] - LY / 2) / 1e3), 6, ypos + 3);
    }
  }

  function drawColorbar(cv, lo, hi, unit, lutArr, seq) {
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { ctx, w, h } = fit;
    for (let k = 0; k < w; k++) {
      const c = lutArr[Math.max(0, Math.min(255, Math.round((k / (w - 1)) * 255)))];
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(k, 0, 1, h);
    }
    const lbl = cv.parentElement.querySelector(".cb-labels");
    if (lbl) {
      const f = (x) => {
        const a = Math.abs(x);
        const d = a < 1 ? 2 : a < 10 ? 1 : 0;
        return (Math.abs(x) < 1e-9 ? "0" : x.toFixed(d)) + (unit || "");
      };
      lbl.querySelector(".cb-min").textContent = f(lo);
      lbl.querySelector(".cb-mid").textContent = seq ? f((lo + hi) / 2) : "0";
      lbl.querySelector(".cb-max").textContent = f(hi);
    }
  }

  // --------------------------------------------- covariance + localization
  // marginal expectation E[T(x-δ)] of the hump under Gaussian translation
  function E1(x, y) {
    return A * (SH2 / E1DEN) * Math.exp(-(x * x + y * y) / (2 * E1DEN));
  }

  // true (analytic) covariance field: exact hump-displacement covariance
  // E[T(x-δ)T(y-δ)] - E[T(x-δ)]E[T(y-δ)], plus the background covariance
  // B^2 exp(-|o-p|^2 / 2L^2)
  function trueCovField(oi, oj) {
    const out = new Float32Array(NP);
    const xo = xM[oi] - XC, yo = yM[oj] - YC;
    const e1o = E1(xo, yo);
    const ro2 = xo * xo + yo * yo;
    for (let j = 0; j < NY; j++) {
      const dy = yM[j] - yM[oj];
      const yp = yM[j] - YC;
      const sy = yo + yp;
      for (let i = 0; i < NX; i++) {
        const xp = xM[i] - XC;
        const sx = xo + xp;
        const e2 = A2 * Math.exp(-(ro2 + xp * xp + yp * yp) / (2 * SH2))
                 * Math.exp((sx * sx + sy * sy) * SP2 / (2 * SH2 * SH2 * E2DEN)) / E2DEN;
        const humpCov = e2 - e1o * E1(xp, yp);
        const dx = xM[i] - xM[oi];
        out[j * NX + i] = humpCov + B2 * Math.exp(-(dx * dx + dy * dy) / (2 * LBG2));
      }
    }
    return out;
  }

  // sample covariance of the observation ensemble with the state ensemble at
  // every grid point: cov[p] = (1/(n-1)) Σ_m (s_m,p − s̄_p)(o_m − ō)
  function computeCov(oi, oj, n) {
    const oens = new Float32Array(n);
    let mo = 0;
    const base = oj * NX + oi;
    for (let m = 0; m < n; m++) {
      const v = pool[m * NP + base];
      oens[m] = v; mo += v;
    }
    mo /= n;
    const means = new Float32Array(NP);
    for (let m = 0; m < n; m++) {
      const b = m * NP;
      for (let p = 0; p < NP; p++) means[p] += pool[b + p];
    }
    for (let p = 0; p < NP; p++) means[p] /= n;
    const cov = new Float32Array(NP);
    for (let m = 0; m < n; m++) {
      const b = m * NP;
      const o = oens[m] - mo;
      for (let p = 0; p < NP; p++) cov[p] += (pool[b + p] - means[p]) * o;
    }
    const inv = 1 / (n - 1);
    for (let p = 0; p < NP; p++) cov[p] *= inv;
    return { cov, oens, mo };
  }

  // Gaspari–Cohn compact-support function, z = d/c, zero beyond z = 2
  function gc(z) {
    if (z <= 1) return -1 / 4 * z ** 5 + 1 / 2 * z ** 4 + 5 / 8 * z ** 3 - 5 / 3 * z ** 2 + 1;
    if (z <= 2) return 1 / 12 * z ** 5 - 1 / 2 * z ** 4 + 5 / 8 * z ** 3 + 5 / 3 * z ** 2 - 5 * z + 4 - 2 / (3 * z);
    return 0;
  }

  // element-wise multiply by GC(d / (R/2)): full weight at the obs, smooth
  // taper, exactly zero beyond the circle of radius R
  function localized(cov, oi, oj, R) {
    const c = R / 2;
    const out = new Float32Array(NP);
    for (let j = 0; j < NY; j++) {
      const dy = yM[j] - yM[oj];
      for (let i = 0; i < NX; i++) {
        const d = Math.hypot(xM[i] - xM[oi], dy);
        out[j * NX + i] = cov[j * NX + i] * gc(d / c);
      }
    }
    return out;
  }

  // ------------------------------------------------------------- render
  // cached results of the last computation (reused by the tooltip)
  let lastCovShow = null, lastCovTrue = null;

  function render() {
    const stops = LUT_STOPS[theme];
    const l2 = makeLUT(stops, divMap);
    lut.splice(0, lut.length, ...l2);
    const th2 = makeLUT(LUT_THERMAL[theme], seqMap);
    lutTh.splice(0, lutTh.length, ...th2);

    // true covariance (analytic) + sample covariance for current n and obs
    const covTrue = trueCovField(oi, oj);
    const { cov } = computeCov(oi, oj, nens);
    const covShow = locOn ? localized(cov, oi, oj, R) : cov;
    lastCovShow = covShow;
    lastCovTrue = covTrue;

    // common symmetric colour range for the two covariance panels, fixed at
    // ±COV_RANGE (n- and location-independent): the true panel never moves,
    // the sample is compared against it directly, and sample values that
    // exceed the truth saturate the scale — spurious far-field noise shows
    // up as saturated colour.
    const cmax = COV_RANGE;

    // truth map (thermal colormap, positive range 0..vmax)
    drawMap($("map-truth"), truthT, 0, vmax, lutTh);
    drawColorbar($("cb-truth"), 0, vmax, " K", lutTh, true);
    // true covariance map (diverging)
    drawMap($("map-true"), covTrue, -cmax, cmax, lut);
    drawColorbar($("cb-true"), -cmax, cmax, " K\u00B2", lut, false);
    // sample covariance map (raw or localized)
    drawMap($("map-cov"), covShow, -cmax, cmax, lut);
    drawColorbar($("cb-cov"), -cmax, cmax, " K\u00B2", lut, false);

    // readout: sample vs true, at the obs and as field extrema
    const sMin = minOf(covShow), sMax = maxOf(covShow);
    const tMin = minOf(covTrue), tMax = maxOf(covTrue);
    const f = (x) => (Math.abs(x) < 1e-9 ? "0" : x.toFixed(2));
    let html =
      `Obs <strong>(${oi}, ${oj})</strong> \u00B7 truth T = <strong>${truthT[oj * NX + oi].toFixed(1)}</strong> K \u00B7 ` +
      `n = <strong>${nens}</strong> members \u00B7 ` +
      `sample cov <strong>+${f(sMax)} / ${f(sMin)}</strong> K\u00B2 \u00B7 ` +
      `true cov <strong>+${f(tMax)} / ${f(tMin)}</strong> K\u00B2`;
    if (locOn) html += ` \u00B7 localized: beyond L = <strong>${Math.round(R / 1e3)} km</strong> set to 0`;
    $("readout").innerHTML = html;
  }

  function minOf(f) { let m = Infinity; for (let p = 0; p < NP; p++) if (f[p] < m) m = f[p]; return m; }
  function maxOf(f) { let m = -Infinity; for (let p = 0; p < NP; p++) if (f[p] > m) m = f[p]; return m; }

  function drawMap(cv, field, lo, hi, lutArr) {
    const fit = fitCanvas(cv);
    if (!fit) return;
    drawField(fit.ctx, fit.w, fit.h, field, lo, hi, lutArr);
    drawCircle(fit.ctx, fit.w, fit.h);
    drawObs(fit.ctx, fit.w, fit.h);
    drawMapAxis(fit.ctx, fit.w, fit.h);
  }

  // --------------------------------------------------------- interaction
  // dragging anywhere on a map moves the observation
  function mapPosToIJ(cv, clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    const fx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const fy = clamp((clientY - rect.top) / rect.height, 0, 1);
    return { i: Math.floor(fx * NX), j: Math.floor(fy * NY) };
  }

  for (const id of ["map-truth", "map-true", "map-cov"]) {
    const cv = $(id);
    let dragging = false;
    const moveTo = (e) => {
      const { i, j } = mapPosToIJ(cv, e.clientX, e.clientY);
      oi = clamp(Math.round(i), 0, NX - 1);
      oj = clamp(Math.round(j), 0, NY - 1);
      render();
    };
    cv.addEventListener("pointerdown", (e) => {
      dragging = true;
      moveTo(e);
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* touch on some iOS versions */ }
    });
    cv.addEventListener("pointermove", (e) => { if (dragging) moveTo(e); });
    cv.addEventListener("pointerup", () => {
      dragging = false;
      hideTooltip();
    });
    cv.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    cv.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const { i, j } = mapPosToIJ(cv, e.clientX, e.clientY);
      showTooltip(e.clientX, e.clientY, i, j);
    });
    cv.addEventListener("pointerleave", hideTooltip);
  }

  // tooltip: value at the hovered cell
  let tip = document.createElement("div");
  tip.id = "tooltip";
  (root || document.body).appendChild(tip);
  function showTooltip(cx, cy, i, j) {
    const p = j * NX + i;
    const s = lastCovShow ? lastCovShow[p] : 0;
    const t = lastCovTrue ? lastCovTrue[p] : 0;
    tip.innerHTML =
      `<strong>(${i}, ${j})</strong>` +
      ` \u00B7 T = ${truthT[p].toFixed(2)} K` +
      ` \u00B7 sample cov = ${s.toFixed(2)} K\u00B2` +
      ` \u00B7 true cov = ${t.toFixed(2)} K\u00B2`;
    tip.style.display = "block";
    const pad = 14;
    let lx = cx + pad, ly = cy + pad;
    if (lx + 240 > window.innerWidth) lx = cx - 260;
    if (ly + 30 > window.innerHeight) ly = cy - 40;
    tip.style.left = lx + "px";
    tip.style.top = ly + "px";
  }
  function hideTooltip() { tip.style.display = "none"; }

  // ------------------------------------------------------------ controls
  const nensEl = $("ctl-nens"), locEl = $("ctl-loc"), locOnEl = $("ctl-locon");
  if (nensEl) {
    nensEl.value = nens;
    nensEl.addEventListener("input", () => {
      nens = clamp(parseInt(nensEl.value, 10) || 5, 5, POOL);
      $("nens-val").textContent = nens;
      render();
    });
  }
  if (locEl) {
    locEl.value = R / 1e3;
    locEl.addEventListener("input", () => {
      R = (parseFloat(locEl.value) || 0) * 1e3;
      $("loc-val").textContent = Math.round(R / 1e3) + " km";
      render();
    });
  }
  if (locOnEl) {
    locOnEl.checked = locOn;
    locEl.disabled = !locOn;
    $("loc-val").classList.toggle("dim", !locOn);
    locOnEl.addEventListener("change", () => {
      locOn = locOnEl.checked;
      locEl.disabled = !locOn;
      $("loc-val").classList.toggle("dim", !locOn);
      render();
    });
  }

  // ----------------------------------------------------------------- init
  window.addEventListener("resize", () => render());
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => render());
    ro.observe(root);
    for (const id of ["map-truth", "map-true", "map-cov"]) ro.observe($(id));
  }
  requestAnimationFrame(render);
  if (document.readyState !== "complete") addEventListener("load", render);
  setTheme(theme);   // sets data-theme + first render
})();
