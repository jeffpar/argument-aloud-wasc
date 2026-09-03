# argument-aloud-wasc

Data endpoint for the **Washington State Supreme Court** ("WA Supreme Court") on
[Argument Aloud](https://argumentaloud.org).

- The files under `courts/wasc/` are edited in the main `argument-aloud` repo (where the
  folder is git-ignored) and pushed here by that repo's `publish.sh`.
- The **`website` branch** holds `courts/wasc/`'s contents flattened at the repo root and is
  what GitHub Pages serves at `https://wasc.argumentaloud.org` (root-relative URLs, e.g.
  `/index.json`, `/terms/…`). GitHub Pages adds `Access-Control-Allow-Origin: *`, so the
  explorer at `argumentaloud.org` can fetch this data cross-origin.
- Local dev: `bundle exec jekyll serve --port 4013 --source courts/wasc --config _config.yml`
  (a VS Code task does this on folder open) → `http://localhost:4013`.

Users never browse this origin directly; the explorer loads court data from here when the
in-app court selector is set to WA Supreme Court (`?court=wasc`).
