/* Ensemble 4 K contour explorer — Ch. 2.
   Shows the truth warm blob with its 4 K contour, overlaid with the 4 K
   contour of every ensemble member (thin, coloured, Tab20 palette) and the
   truth's own contour (thick, haloed). A member slider walks through the
   100 members and highlights one, reporting its blob-centre displacement
   from the truth. Uses the same synthetic data as the Observation–State
   Correlation Explorer (window.NEDAS_DATA): the ensemble perturbs only the
   blob's position, so each 4 K contour is the same circle displaced
   somewhere else — the band of rings is the position uncertainty.
*/
(function () {
  "use strict";

  const D = window.NEDAS_DATA;
  if (!D) {
    document.body.innerHTML = "<p style='font:1rem sans-serif;padding:2rem'>" +
      "No data found. Run <code>python generate_data.py</code> to create <code>data.js</code>.</p>";
    return;
  }

  const $ = (id) => document.getElementById(id);
  const nx = D.meta.nx, ny = D.meta.ny, nens = D.meta.nens;
  const LKM = D.meta.Lx / 1e3;             // domain width, km (500)
  const truthT = D.truth.T;                // [j][i]
  const ensT = D.ens.T;                    // [j][i][m]
  const LEVEL = 4.0;                       // contour level, K
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ------------------------------------------------------------- theme
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkMq.matches ? "dark" : "light";
  // own wrapper id, so this widget works alongside the correlation explorer
  // on the same page (each app targets its own .da-widget)
  const root = document.getElementById("contour-explorer") ||
    document.querySelector(".da-widget") || document.documentElement;
  const setTheme = (t) => { theme = t; root.dataset.theme = t; render(); };
  darkMq.addEventListener("change", (e) => setTheme(e.matches ? "dark" : "light"));
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

  // ------------------------------------------- sequential truth LUT
  // YlOrRd (ColorBrewer) in light mode, bright thermal in dark mode — same
  // as the other truth maps in the tutorial
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

  // ------------------------------------------------ marching squares
  // segments of the LEVEL contour of a flat field (value at j*nx+i),
  // in normalised map coordinates
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

  // ---- precompute truth + member contours and member blob centres
  const truthSegs = contourSegs((() => {
    const f = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = truthT[j][i];
    return f;
  })());

  const memberSegs = new Array(nens);
  const memberCentres = new Float64Array(nens * 2);   // normalised (0..1)
  const memberRadius = new Float64Array(nens);        // km
  {
    const f = new Float64Array(nx * ny);
    for (let m = 0; m < nens; m++) {
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = ensT[j][i][m];
      const segs = contourSegs(f);
      memberSegs[m] = segs;
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < segs.length; k++) { sx += segs[k][0] + segs[k][2]; sy += segs[k][1] + segs[k][3]; n += 2; }
      const cx = sx / n, cy = sy / n;
      memberCentres[2 * m] = cx; memberCentres[2 * m + 1] = cy;
      let sr = 0;
      for (let k = 0; k < segs.length; k++) {
        sr += Math.hypot(segs[k][0] - cx, segs[k][1] - cy) + Math.hypot(segs[k][2] - cx, segs[k][3] - cy);
      }
      memberRadius[m] = (sr / (2 * segs.length)) * LKM;
    }
  }

  // member palette (Tab20-style cycle, same as the rankine widget)
  const MEM_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  const memColor = (m) => MEM_COLORS[m % MEM_COLORS.length];

  // ------------------------------------------------------------ state
  let sel = 49;                    // selected member, 0-based (default #50)

  // ------------------------------------------------------ canvas utils
  function fitCanvas(cv) {
    const rect = cv.getBoundingClientRect();
    if (!(rect.width > 0.5) || !(rect.height > 0.5)) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  function drawField(ctx, W, H, lo, hi) {
    const off = document.createElement("canvas");
    off.width = nx; off.height = ny;
    const octx = off.getContext("2d");
    const img = octx.createImageData(nx, ny);
    const data = img.data;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const t = clamp((truthT[j][i] - lo) / (hi - lo || 1), 0, 1);
        const c = lutTh[Math.round(t * 255)];
        const p = (j * nx + i) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, W, H);
  }

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

  // axis ticks on the map (km, centred on domain)
  function drawMapAxis(ctx, W, H) {
    const ink = cssVar("--ink-3");
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = ink;
    const cticks = [5, 15, 25, 35, 45];
    for (const c of cticks) {
      const xpos = ((c + 0.5) / nx) * W;
      ctx.beginPath();
      ctx.moveTo(xpos, H - 1); ctx.lineTo(xpos, H - 4);
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(Math.round((D.x[c] - D.meta.Lx / 2) / 1e3), xpos, H - 6);
      const ypos = ((c + 0.5) / ny) * H;
      ctx.beginPath();
      ctx.moveTo(0, ypos); ctx.lineTo(4, ypos);
      ctx.strokeStyle = ink; ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(Math.round((D.y[c] - D.meta.Ly / 2) / 1e3), 6, ypos + 3);
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

  // ------------------------------------------------------------- render
  function render() {
    const l2 = makeLUT(LUT_THERMAL[theme]);
    lutTh.splice(0, lutTh.length, ...l2);

    const cv = $("cont-map");
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { ctx, w, h } = fit;

    // truth field
    drawField(ctx, w, h, 0, vmax);

    // every member's 4 K contour (thin, coloured, dimmed)
    for (let m = 0; m < nens; m++) {
      if (m === sel) continue;
      drawSegs(ctx, w, h, memberSegs[m], memColor(m), 1, 0.45);
    }
    // selected member (thick, full opacity) + its blob centre
    drawSegs(ctx, w, h, memberSegs[sel], memColor(sel), 2.4, 1);
    {
      const cx = memberCentres[2 * sel] * w, cy = memberCentres[2 * sel + 1] * h;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = cssVar("--accent-fill");
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = memColor(sel);
      ctx.stroke();
    }
    // truth 4 K contour: white halo + dark core so it reads on every colour
    drawSegs(ctx, w, h, truthSegs, cssVar("--series-ink") === "#ffffff" ? "#241439" : "#ffffff", 3.4, 0.95);
    drawSegs(ctx, w, h, truthSegs, cssVar("--series-ink"), 1.6, 1);

    drawMapAxis(ctx, w, h);
    drawColorbar($("cont-cb"), 0, vmax);

    // readout
    const m = sel;
    const dx = (memberCentres[2 * m] - 0.5) * LKM;
    const dy = (memberCentres[2 * m + 1] - 0.5) * LKM;
    const sgn = (x) => (Math.abs(x) < 0.5 ? "0" : (x > 0 ? "+" : "−") + Math.abs(x).toFixed(0));
    $("cont-readout").innerHTML =
      `member <strong>${m + 1}</strong> \u00B7 blob centre <strong>(${sgn(dx)}, ${sgn(dy)}) km</strong> from truth \u00B7 ` +
      `4 K contour radius \u2248 <strong>${memberRadius[m].toFixed(0)} km</strong>`;
  }

  // ------------------------------------------------------------ controls
  const memEl = $("cont-mem"), memVal = $("cont-mem-val");
  if (memEl) {
    memEl.value = sel + 1;
    memEl.addEventListener("input", () => {
      sel = clamp(parseInt(memEl.value, 10) || 1, 1, nens) - 1;
      memVal.textContent = sel + 1;
      render();
    });
  }

  // ----------------------------------------------------------------- init
  window.addEventListener("resize", () => render());
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => render());
    ro.observe(root);
    ro.observe($("cont-map"));
  }
  requestAnimationFrame(render);
  if (document.readyState !== "complete") addEventListener("load", render);
  setTheme(theme);
})();
