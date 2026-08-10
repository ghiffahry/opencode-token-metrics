# AGENTS.md · Token Metrics

Local dashboard + opencode plugin for monitoring opencode API token usage.

## Commands

```bash
py -m server_app.httpd     # dev server + API at http://127.0.0.1:8124/
py app/desktop.py          # desktop app (pywebview, random loopback port)
py tools/start.py          # start server detached
py tools/stop.py           # stop the running server
py tools/db_stats.py       # opencode DB overview
py tools/git_commit.py     # stage + commit helper (conventional commits)
```

## Conventions

- **Conventional commits**: `feat:`, `fix:`, `perf:`, `chore:`, `docs:`, `refactor:`, `build:`.
- **Pre-commit hook** (tracked at `tools/git-hooks/pre-commit`) runs a Python
  `py_compile` syntax check. Install once with
  `git config core.hooksPath tools/git-hooks`.
- Backend lives in the `server_app/` package (config, db, ranges, estimates,
  overview, context, routes, httpd); run it with `py -m server_app.httpd`.
- Frontend is ES modules under `web/static/js/` (core/, data/, render/, live/,
  app/, ui/); no bundler, no framework; keep vanilla JS and match existing
  style. Dashboard page is `web/index.html`.
- Data is read from the real `opencode.db` in read-only/WAL-safe mode; never
  write to it. UI strings may be localized, but code/comments stay English.

## Plugin

The opencode plugin lives in `opencode/` (npm package `opencode-token-metrics`).
It captures live token usage from opencode events and writes `state.json` under
`TOKENMETRICS_STATE` (default `~/.local/share/token-metrics/`). Keep it
dependency-light and synchronous-friendly.
