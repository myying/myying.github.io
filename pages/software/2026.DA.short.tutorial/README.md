# Data Assimilation Interactive Tutorials (widget series)

A series of small interactive web widgets demonstrating core data-assimilation
ideas, hosted on the site under "Software & Tutorials". This directory is the
home of the series; each chapter is a page with one or more embedded widgets,
followed by a "Reading the panels" section that explains what each panel shows
in prose. The tutorial structure follows Evensen, Vossepoel & van Leeuwen,
*Data Assimilation Fundamentals* (Springer, 2022).

## Current contents

| Path | Purpose |
|---|---|
| `title` | Listing title used by `compile.sh` |
| `abstract.html` | Listing abstract shown on `software.html` |
| `toc.html` | Chapter table of contents — series hub (widget-nav back to `software.html`) |
| `chapters.css` | Shared chapter-page styles: page column, `.widget-nav` (home + arrow buttons, highlighted current title), `.planned` panel |
| `01-bayes-gaussians.html` | Ch 1 page: Bayes' rule for Gaussians — 1-D and 2-D widgets on one page + annotations |
| `02-observation-state-correlation.html` | Ch 2 page: merged Observation–State Correlation Explorer (truth + 4 K contours, member slider, correlation map, scatter) + annotations |
| `03-ensemble-kalman-filter.html` | Ch 3 page: §1 Ensemble Kalman Filter Explorer — live stochastic EnKF update of the Ch 2 ensemble (background/analysis 4 K contour panels, bg→an scatter with update arrow, member + obs-error σ_o sliders, state marker) + §2 Cycling EnKF Explorer — repeated forecast→observe→analyze on a drifting warm-blob storm on a periodic domain (perfect, known velocity), observed by a 3x3 nine-station network each cycle (serial EnKF), storm-track map + spread-vs-rms-error time series (N_ens fixed at 50, not user-tunable) + step/run/reset + annotations |
| `widgets/enkf-explorer/app.js` | Ch 3 widget: in-browser EnKF x_a = x_b + K(y−Hx_b) with perturbed obs; gain = P_bHᵀ/(HP_bHᵀ+R); marching-squares contours of bg & an ensembles with ensemble-mean field shading on both panels (shared adaptive scale); σ_o slider (cached analysis recompute); obs-error band + update arrow in scatter; click a bg or an scatter point to select that member |
| `widgets/enkf-explorer/style.css` | Ch 3 widget styles (scoped to `.da-widget`, from corr-explorer) |
| `widgets/enkf-explorer/data.js`, `build_enkf_data.py` | Ch 3 §1 data: reuses Ch 2 experiment + `obs_z` unit normals for the perturbed obs (build script) |
| `widgets/cycle-explorer/app.js`, `style.css` | Ch 3 §2 widget (id `cycle-explorer`): moving warm-blob storm (Ch 2's A/σ) on a periodic (wrap-around) domain, state = (cx, cy), serial vector stochastic EnKF against a 3x3 nine-station observation network each cycle, no inflation control. Purely deterministic perfect-model forecast — truth and every member move by the exact same known velocity, no noise anywhere — so spread shrinks every cycle with nothing to replenish it and the mean always tracks the truth exactly (harmless here; Ch 4 adds mild matched gustiness plus a velocity bias that isn't harmless). Circular (periodic-aware) mean/spread/rmse throughout, since a plain arithmetic mean is wrong once the ensemble straddles the domain seam. Rolling 600-cycle history window; truth track breaks into segments at wrap jumps; auto-run capped at 500 cycles |
| `04-localization-inflation.html` | Ch 4 page: §1 Sample Covariance Explorer — truth (compact hump + smooth random background), analytic true covariance, and sample covariance (raw or Gaspari–Cohn localized); drag the observation, ensemble-size / localization-radius sliders, localization toggle + radius circle + §2 Inflation Explorer — same cycling, 3x3 nine-station, deterministic-truth storm as Ch 3 §2, but the ensemble's forecast assumes a systematic bias in the storm's mean velocity (drifts noticeably slower than truth, about 2/3 speed); inflation is a position perturbation (0–25 km, std of an independent random kick applied to every member's position after each analysis), the same mechanism as jitter but applied post-analysis instead of during the forecast + annotations |
| `widgets/cov-explorer/app.js` | Ch 4 §1 Sample Covariance Explorer logic — computed live in the browser (seeded 300-member pool: displaced hump + smooth random background per member; analytic true-covariance field; no data file) |
| `widgets/cov-explorer/style.css` | Ch 4 §1 widget styles (scoped to `.da-widget`, incl. controls / switch / localization circle) |
| `widgets/inflation-explorer/app.js`, `style.css` | Ch 4 §2 widget (id `inflation-explorer`): same cycling, periodic-domain, 3x3 nine-station, deterministic-truth engine as `cycle-explorer`, but the ensemble's forecast assumes a systematic bias in the storm's mean velocity — every member drifts noticeably slower than the truth, about 2/3 speed (VEL_ENS = VEL_TRUE + BIAS, BIAS = {-3, 1} km/cycle, truth speed 9.5 vs ensemble speed ~6.3). Inflation is a position perturbation, not multiplicative scaling: a slider (0–25 km) sets the std of an independent random kick applied to every member's position after each analysis — the same mechanism as jitter, just applied post-analysis instead of during the forecast. Confirmed numerically stable across the full range, with the best correction around 5–8 km (rms error down to ~20 km, well inside the storm's ~59 km footprint) |
| `05-challenges-dynamical-systems.html` | Ch 5 page: challenges from dynamical systems — Lorenz-96 chaos widget + embedded vort3d uncertainty demo |
| `vort3d-demo.html`, `widgets/vort3d-data/` | The vort3d uncertainty demo (20-realization hurricane forecast: track/intensity/size + maps & cross-sections), embedded by Ch 5; data bundle + build script inside `widgets/vort3d-data/` |
| `06-nonlinear-filters.html` | Ch 6 page: §1 Gaussian-hump / position-error widget (position errors break the Gaussian prior — same blob as Ch 2, spaghetti + shading rendered like Ch 2's panel, member-distribution KDE, clickable P, click-to-select member in the mechanism scatter, skew/kurt verdict) + §2 EnKF-vs-particle-filter widget — prior / EnKF-analysis / PF-posterior 4 K contour-spaghetti panels on the same hump prior (PF members light up ∝ weight), obs T(P) = 4 K, Lsprd + Nens sliders, Neff / centre-distance readout + annotations |
| `07-parameters-applications.html` | Ch 7 page: Parameter Estimation Explorer — same cycling, 3x3 nine-station storm as Ch 3, with the same perfectly deterministic truth (no jitter, unlike Ch 4), state augmented to (cx, cy, u, v): velocity is a persistence parameter, estimated purely from repeated station observations of temperature via its cross-covariance with the innovation; storm-track map (member cluster — spread comes entirely from velocity disagreement, no position perturbation — + ensemble mean + truth track/footprint, no velocity ray), drift-speed panel (cyan per-member cluster + thicker blue ensemble-mean line + dashed true-speed reference), and the same position spread-vs-rms-error panel as Ch 3/4 (not velocity-specific); "Estimation: on/off" toggle freezes velocity (no analysis update, no perturbation) to show the widget with parameter estimation switched off + annotations |
| `widgets/param-explorer/app.js`, `style.css` | Ch 7 widget (id `param-explorer`): augmented-state (4-component) vector stochastic EnKF, deterministic truth (no jitter), velocity prior centred slightly LOW (mean speed 4 km/cycle vs. true ~9.5, not "no idea") with spread 3 km/cycle, so convergence is visible from a modest first guess. No bias-correcting inflation (unlike Ch 4) — velocity is a genuinely static unknown, so its spread collapsing as evidence accumulates is mostly correct — but a small background perturbation (VEL_PERT = 0.05 km/cycle) is still applied post-analysis: testing VEL_PERT = 0 showed a fully collapsed ensemble loses all Kalman-gain leverage to self-correct, so a minority of runs (confirmed numerically, ~1/4) lock onto a persistently wrong estimate; 0.05 keeps just enough spread alive to prevent that (worst-case trial error ~1.7 vs. true speed ~9.5) without preventing convergence (0.4 and 0.1, tried earlier, were both too large). Position gets no perturbation at all (unlike Ch 4) — it relies entirely on each member's own estimated velocity to track the truth; a position-perturbation slider (like Ch 4's) was tried and dropped, since it turned out not to matter much either way (confirmed numerically: 0 km performs about as well as small nonzero values), so the simpler no-control choice was kept. `ESTIMATE_VEL` toggle (button) gates both the velocity analysis update and the velocity perturbation, freezing (u,v) when off. The storm-track map no longer draws an implied-future-track ray from the ensemble-mean velocity (removed per request). Per-member drift-speed history (rolling MAXHIST window) drives the cyan-cluster/blue-mean speed panel, with a background-colored halo stroke behind the blue mean line so it stays legible against the cyan cluster in dark mode (where the theme's lighter blue reads close to cyan without it); the third time-series panel reuses position spread/rmse (same as Ch 3/4) rather than velocity spread/error. No "step" button (removed from all three cycling widgets — `cycle-explorer`, `inflation-explorer`, `param-explorer` — leaving just run/reset(/toggle)) |
| `widgets/corr-explorer/app.js` | Widget logic: truth T + marching-squares 4 K contours of truth & all members (Tab20 palette), member slider (highlight + blob-centre readout + scatter ring), click-a-scatter-dot to select that member, state marker with live corr/scatter (embedding-ready copy) |
| `widgets/corr-explorer/style.css` | Widget styles incl. member-slider controls + contour legend marks (scoped to `.da-widget`) |
| `widgets/corr-explorer/data.js` | Synthetic demo data (generated) |
| `widgets/pf-explorer/app.js` | Ch 6 §2 widget: in-browser EnKF (exact Ch 3 per-grid-cell stochastic formula, xa = xb + K(y+eps−Hxb)) vs particle filter (likelihood weights) on the same Gaussian-hump prior as §1; three 4 K contour-spaghetti panels (prior / EnKF / PF, per-member Tab20 colours, PF brightness+width ∝ weight), mean-field shading (prior/EnKF-analysis mean, PF weighted mean; shared 0–8 K scale), tunable σ_o, Lsprd + Nens sliders, Neff + rms-centre-distance readout |
| `widgets/pf-explorer/style.css` | Ch 6 §2 widget styles, scoped to `#pf-explorer` so it coexists with the position-error widget on the same page |
| `widgets/position-error/app.js`, `style.css` | Ch 6 §1 widget (id `position-error`): Gaussian-hump ensemble — panel (a) rendered like the Ch 2 / §2 spaghetti panels (YlOrRd truth shading, 4 K rings per member, haloed truth ring, selected-member highlight), panel (b) KDE/histogram of the members' T(P) values (not the error) with Gaussian fit + skew/kurt verdict, panel (c) non-monotone T(P)-vs-displacement mechanism scatter (click a dot to select that member, highlighted in both (a) and (c)), clickable P, Lsprd (units of σ) + Nens sliders, dx = 10 km / domain matching the Ch 2 grid setting |
| `widgets/bayes-gaussian/app.js` | 1-D Bayes widget logic (embedding-ready, no data file — computed live) |
| `widgets/bayes-gaussian/style.css` | 1-D Bayes widget styles (scoped to `.da-widget`) |
| `widgets/bivariate-gaussian/app.js` | 2-D Bayes widget logic (embedding-ready, no data file — computed live) |
| `widgets/bivariate-gaussian/style.css` | 2-D Bayes widget styles (scoped to `.da-widget`) |
| `widgets/lorenz96/app.js` | Lorenz-96 chaos & predictability widget (computed live, no data file) |
| `widgets/lorenz96/style.css` | Lorenz-96 widget styles (scoped to `.da-widget`) |

The upstream/standalone source of the correlation-explorer widget lives in
`~/Google_Drive/notes/software_tutorial/DA/` (README there documents the
physics and data generation). The copies here are adapted for embedding.

## How a widget is embedded

1. The widget markup lives directly in the chapter page, wrapped in
   `<div class="da-widget" id="...">`. When a page hosts more than one widget,
   give each wrapper a unique id (e.g. `bayes-gaussian`, `bivariate-gaussian`).
2. `style.css` is the widget stylesheet **scoped**: every selector is prefixed
   with `.da-widget` and the CSS custom properties are declared on the wrapper
   instead of `:root`, so it cannot clash with the site stylesheet. When the
   upstream `style.css` changes, re-derive the scoped copy:
   - `:root` → `.da-widget`
   - `:root[data-theme="dark"]` → `.da-widget[data-theme="dark"]`
   - `body {…}` → `.da-widget {…}` (drop the bare `body` rule)
   - prefix every other selector with `.da-widget `
   - `#tooltip` → `.da-widget #tooltip`
3. `app.js` is embedding-ready (kept in sync with the upstream file; the only
   differences are small blocks marked with comments):
   - widget root = `document.getElementById("<wrapper id>")` — **required when
     a page hosts several widgets**, since `document.querySelector(".da-widget")`
     would otherwise always return the first one (falls back to
     `document.querySelector(".da-widget")` then the document root);
   - the tooltip is appended to that root so it inherits the CSS variables;
   - a `ResizeObserver` re-renders when the site page reflows the widget;
   - the light/dark toggle button is dropped: the theme follows the browser's
     `prefers-color-scheme` setting automatically (upstream still has the
     button); the `nens-label` lookup is guarded for the same reason.
   - the maps get `touch-action: none` (scoped CSS) and the tooltip is
     mouse-only + hidden on drag end, so touch dragging moves the marker
     instead of scrolling the page.
   The embedded page also omits the widget's hero and footnote text, which the
   chapter page itself supplies.
4. `data.js` is copied from `generate_data.py` output (deterministic, seed 42).
   Regenerate with `python3 generate_data.py` in the notes folder and copy the
   resulting `data.js` here. The Gaussian widgets need no data file — they
   compute everything live.

## Adding a new chapter

- Copy `01-bayes-gaussians.html` as the template; each chapter gets its own
  `.da-widget` wrapper(s) and its own `widgets/<name>/` asset folder (give the
  widget's element ids a unique prefix when a page hosts more than one widget,
  since `app.js` looks them up by id). Chapter pages link the shared
  `chapters.css` for the page column, the `.widget-nav` (home + arrow buttons
  around the highlighted current chapter title) and the `.planned` panel.
- Name chapter pages `<nn>-<slug>.html` in reading order (e.g.
  `09-my-new-chapter.html`) and add the entry to `toc.html`.
- Update the `.widget-nav` block at the top of every chapter page: point the
  `.nav-home` link at `toc.html` (series outline; `toc.html`'s own widget-nav
  links back to `software.html`), set the chapter title in `.nav-current`,
  and replace the disabled prev/next `.nav-arrow` spans with `<a href>` links
  once the neighbouring chapter exists.
- The chapter pages live in `pages/software/<year>.<name>/` alongside `title` +
  `abstract.html`; re-run `compile.sh` afterwards to regenerate the
  `software.html` listing.
