# Contributing

Thanks for helping with Token Metrics.

## Setup

```bash
py -m pip install -e ".[desktop]"       # desktop GUI deps (server is stdlib-only)
py -m pip install pytest                # python tests
git config core.hooksPath tools/git-hooks   # install pre-commit syntax check
```

## Commands

```bash
py -m server_app.httpd          # dev server + API at http://127.0.0.1:8124/
py app/desktop.py               # desktop app (pywebview)
py tools/start.py               # start server detached
py tools/stop.py                # stop the running server
py tools/qa_sweep.py            # endpoint smoke sweep against a running server

py -m pytest tests -q           # python tests
npm --prefix opencode ci        # plugin deps
npm --prefix opencode test      # plugin tests (window bounds, dedup, persistence)
npm --prefix opencode run pack:check   # verify npm tarball contents
```

## Conventions

- Conventional commits: `feat:`, `fix:`, `perf:`, `chore:`, `docs:`, `refactor:`, `build:`.
- Backend in `server_app/` (stdlib-only HTTP + sqlite3, read-only DB access).
- Frontend is vanilla ES modules under `web/static/js/` - no bundler, no framework.
- Plugin in `opencode/` stays dependency-light and never breaks the host.
- UI strings may be localized; code and comments stay English.

## Data validity (please keep honest)

- Database numbers = **actual historical** usage from `opencode.db`.
- Quota windows = **estimates** (provider never publishes reset timing).
- Plugin numbers = **events captured since the plugin became active**.
Never present estimates as provider facts.

## Testing

Add a test with any non-trivial change:

- Python: `tests/test_*.py` (pytest).
- Plugin: `opencode/test/*.test.mjs` (node:test). The window math in
  `opencode/plugins/quota.js` must stay in sync with
  `server_app/ranges.py::quota_window_bounds`.

## Releasing

1. `npm --prefix opencode version <major.minor.patch>` (bumps plugin package).
2. Update `server_app/config.py` `VERSION`.
3. Commit: `build: release vX.Y.Z`.
4. Tag `vX.Y.Z` and push. The release workflow runs the checks and creates a
   GitHub release from the tag.
5. Publish the plugin: `npm --prefix opencode publish` (requires npm login +
   `TOKENMETRICS` npm auth). CI's `pack:check` verifies the tarball first.
