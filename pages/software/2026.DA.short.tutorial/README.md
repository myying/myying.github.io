# Data Assimilation Interactive Tutorials (widget series)

A series of small interactive web widgets demonstrating core data-assimilation
ideas, hosted on the site under "Software & Tutorials". This directory is the
home of the series; each chapter is a page with one or more embedded widgets,
followed by a "Reading the panels" section that explains what each panel shows
in prose. The course structure follows Evensen, Vossepoel & van Leeuwen,
*Data Assimilation Fundamentals* (Springer, 2022).

## Current contents

| Path | Purpose |
|---|---|
| `title` | Listing title used by `compile.sh` |
| `abstract.html` | Listing abstract shown on `software.html` |
| `toc.html` | Chapter table of contents — series hub (widget-nav back to `software.html`) |
| `chapters.css` | Shared chapter-page styles: page column, `.widget-nav` (home + arrow buttons, highlighted current title), `.planned` panel |
| `01-bayes-gaussians.html` | Ch 1 page: Bayes' rule for Gaussians — 1-D and 2-D widgets on one page + annotations |
| `02-observation-state-correlation.html` | Ch 2 page: Observation–State Correlation Explorer + annotations |
| `03-challenges-dynamical-systems.html` | Ch 5 page: challenges from dynamical systems — Lorenz-96 chaos widget + embedded vort3d uncertainty demo |
| `vort3d-demo.html`, `widgets/vort3d-data/` | The vort3d uncertainty demo (20-realization hurricane forecast: track/intensity/size + maps & cross-sections), embedded by Ch 3; data bundle + build script inside `widgets/vort3d-data/` |
| `05-ensemble-kalman-filter.html` | Ch 3 page: The ensemble Kalman filter (planned; merged from the former Ch 4–5) — full widget-nav chain, `.planned` panel |
| `06-localization-inflation.html` | Ch 4 page: Sample Covariance Explorer — truth (compact hump + smooth random background), analytic true covariance, and sample covariance (raw or Gaspari–Cohn localized); drag the observation, ensemble-size / localization-radius sliders, localization toggle + radius circle + annotations |
| `07-nonlinear-filters.html`, `08-parameters-applications.html` | Ch 6–7 placeholder pages (planned) — full widget-nav chain, `.planned` panel |
| `widgets/corr-explorer/app.js` | Widget logic (embedding-ready copy) |
| `widgets/corr-explorer/style.css` | Widget styles (scoped to `.da-widget`) |
| `widgets/corr-explorer/data.js` | Synthetic demo data (generated) |
| `widgets/cov-explorer/app.js` | Ch 6 Sample Covariance Explorer logic — computed live in the browser (seeded 300-member pool: displaced hump + smooth random background per member; analytic true-covariance field; no data file) |
| `widgets/cov-explorer/style.css` | Ch 6 widget styles (scoped to `.da-widget`, incl. controls / switch / localization circle) |
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
  `08-parameters-applications.html`) and add the entry to `toc.html`.
- Update the `.widget-nav` block at the top of every chapter page: point the
  `.nav-home` link at `toc.html` (series outline; `toc.html`'s own widget-nav
  links back to `software.html`), set the chapter title in `.nav-current`,
  and replace the disabled prev/next `.nav-arrow` spans with `<a href>` links
  once the neighbouring chapter exists.
- The chapter pages live in `pages/software/<year>.<name>/` alongside `title` +
  `abstract.html`; re-run `compile.sh` afterwards to regenerate the
  `software.html` listing.
