# Data Assimilation Interactive Tutorials (widget series)

A series of small interactive web widgets demonstrating core data-assimilation
ideas, hosted on the site under "Courses". This directory is the
home of the series; each part is a page with one embedded widget, followed
by a "Reading the panels" section that explains what each panel shows in prose.

## Current contents

| Path | Purpose |
|---|---|
| `title` | Listing title used by `compile.sh` |
| `abstract.html` | Listing abstract shown on `software.html` |
| `article.html` | Part 1 page: Observation–State Correlation Explorer + annotations |
| `widgets/corr-explorer/app.js` | Widget logic (embedding-ready copy) |
| `widgets/corr-explorer/style.css` | Widget styles (scoped to `.da-widget`) |
| `widgets/corr-explorer/data.js` | Synthetic demo data (generated) |

The upstream/standalone source of the Part 1 widget lives in
`~/Google_Drive/notes/software_tutorial/DA/` (README there documents the
physics and data generation). The copies here are adapted for embedding.

## How a widget is embedded

1. The widget markup lives directly in `article.html`, wrapped in
   `<div class="da-widget" id="...">`.
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
   - widget root = `document.querySelector(".da-widget")` (falls back to the
     document root for standalone use);
   - the tooltip is appended to that root so it inherits the CSS variables;
   - a `ResizeObserver` re-renders when the site page reflows the widget;
   - the light/dark toggle button is dropped: the theme follows the browser's
     `prefers-color-scheme` setting automatically (upstream still has the
     button); the `nens-label` lookup is guarded for the same reason.
   - the maps get `touch-action: none` (scoped CSS) and the tooltip is
     mouse-only + hidden on drag end, so touch dragging moves the marker
     instead of scrolling the page.
   The embedded page also omits the widget's hero and footnote text, which the
   article page itself supplies.
4. `data.js` is copied from `generate_data.py` output (deterministic, seed 42).
   Regenerate with `python3 generate_data.py` in the notes folder and copy the
   resulting `data.js` here.

## Adding a new part

- Copy `article.html` as the template for the next part; each part gets its own
  `.da-widget` wrapper and its own `widgets/<name>/` asset folder (give the
  widget's element ids a unique prefix if a page will ever host more than one
  widget, since `app.js` looks them up by id).
- Update the `.series-nav` block at the top of every part page so the series
  index stays in sync (mark the current part with class `current`).
- Each widget part page lives in its own `pages/software/<year>.<name>/`
  directory with `title` + `abstract.html`; re-run `compile.sh` afterwards to
  regenerate the `software.html` listing.
