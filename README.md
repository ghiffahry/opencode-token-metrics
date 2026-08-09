# Token Metrics - OpenCode API Usage Dashboard

Desktop dashboard for **opencode** API token usage, rate limits, model context, and session activity. All data is read live from your real `opencode.db`; no mock data, no exposed server.

- **Desktop app (main path)** - `py app/desktop.py` opens a native window (Edge WebView2 via `pywebview`) backed by an embedded loopback server on a random `127.0.0.1` port. Only the window can reach it; no browser tab, no fixed port.
- **Dev server** - `py server.py` serves the same dashboard + API at `http://127.0.0.1:8124/` for development.

```
dashboard-token/
├── app/                     # Desktop app (pywebview window + embedded server)
│   ├── desktop.py           #   Desktop entry: embedded server + pywebview window
│   ├── desktop.pyw          #   Double-click launcher (no console window)
│   ├── TokenMetrics.bat     #   Desktop launcher (starts desktop.pyw)
│   ├── config.json          #   Desktop config (dbPath, window size, port) - auto-created
│   └── app.ico              #   Window / exe icon
├── index.html               # Dashboard markup (loads static/js/main.js as an ES module)
├── server.py                # Local API bridge (thin shim; logic lives in server_app/)
├── server_app/              # Bridge package: config, db, ranges, estimates, overview, context, routes, httpd
├── static/
│   ├── css/
│   │   ├── base.css         # Theme tokens, reset & base
│   │   ├── layout.css       # App layout, sidebar, topbar
│   │   ├── components.css   # Buttons, cards, tables, badges, footer, toast, ...
│   │   ├── responsive.css   # Media queries & reduced motion
│   │   └── widgets.css      # Context-usage widget, token quota, custom range picker
│   ├── favicon.svg          # Dashboard favicon
│   ├── vendor/              # Offline copies of Chart.js, lucide, vis-network (no CDN)
│   └── js/
│       ├── main.js          # Entry point
│       ├── core/            # utils, state
│       ├── data/            # derive (metric computations), csv (exports)
│       ├── render/          # kpis, efficiency, tables, charts, realtime, graph
│       ├── live/            # api (fetch), manager (polling)
│       └── app/             # render (orchestration), controls, init
├── tools/                   # Helper scripts (see table below)
├── runtime/                 # Generated logs, exports, build, and dist artifacts
├── graphify-out/            # Knowledge graph (graph.json + views), updated by graphify
└── README.md                # This guide
```

The frontend is split into ES modules; the old single-file `script.js` has been removed. Because the project filter is backed by server endpoints, the dashboard is served from the same origin as the API - in the desktop app the API base is derived from `window.location`, so any port works automatically.

## Helper scripts

```bash
py tools/start.py            # Start server.py detached; writes logs/server.pid
py tools/stop.py             # Stop the running server (PID file, else port lookup)
py tools/db_stats.py         # OpenCode database overview (counts, sizes, ranges)
py tools/export_csv.py       # CSV exports of requests/models per range into exports/
py tools/context_map.py      # Model -> context-window map (overrides + cache)
py tools/schema_report.py    # OpenCode DB schema (tables, columns, indexes)
py tools/skill_install.py    # Install the graphify CLI + OpenCode skill (idempotent)
py tools/graph_views.py      # Regenerate graphify-out/views (tree / callflow / graph HTML)
py tools/build_desktop.py    # Build the desktop app with PyInstaller (add --build to run)
```

---

## Quick start

### 1. Run the desktop app

Requires Python 3.8+ and `pywebview` (one-time: `py -m pip install pywebview`). The Microsoft Edge WebView2 runtime is preinstalled on most Windows 10/11 machines.

```bash
cd dashboard-token   # where you cloned this repo
py app\desktop.py
```

Double-click `app\desktop.pyw` (or `app\TokenMetrics.bat`) to start it without a console window.

The window is backed by an embedded loopback server bound to a random free `127.0.0.1` port - nothing is exposed and no other browser tab can reach it. `app\config.json` is created on first run next to `desktop.py`:

```json
{
  "dbPath": "",        // "" -> ~/.local/share/opencode/opencode.db
  "host": "127.0.0.1",
  "port": 0,           // 0 -> OS picks a free port
  "width": 1440,
  "height": 900,
  "minWidth": 980,
  "minHeight": 640
}
```

Set `dbPath` if your opencode database lives elsewhere.

### 2. Build a standalone exe (optional)

```bash
py -m pip install pyinstaller pywebview
py tools/build_desktop.py --build
# -> runtime/dist/TokenMetrics/TokenMetrics.exe  (windowed, self-contained folder)
```

### 3. Dev server (optional)

The same dashboard + API is served at `http://127.0.0.1:8124/` for development:

```bash
py server.py
# -> Serving dashboard + API at http://127.0.0.1:8124/
```

Optional flags:

```bash
py server.py --port 9000        # different port
py server.py --host 0.0.0.0     # bind other interfaces (default 127.0.0.1)
py server.py --db <path>        # override database path
```

### 4. Start the dev server detached (PowerShell)

The dev server must keep running; starting it as a background job inside a shell that later exits will kill it. Use `Start-Process` to detach, or simply use the bundled tool:

```powershell
py tools/start.py
# ... and later:
py tools/stop.py
```

Manual equivalent:

```powershell
Start-Process py -ArgumentList "server.py","--port","8124" `
  -WorkingDirectory (Get-Location) -WindowStyle Hidden
```

Stop it with:

```powershell
Get-Process -Name python | Stop-Process -Force
```

The last chosen project is remembered (`localStorage.project`). If the server is unreachable the dashboard shows a warning banner (3 failed polls → toast) instead of fake data.

---

## What the dashboard shows

All metrics are computed from the real opencode database and are **estimates** unless noted:

| Metric | Meaning |
| --- | --- |
| Requests | `assistant` messages that carry a `modelID` (i.e. one model API call per message) |
| Tokens in / out | Sum of `tokens.input` / `tokens.output` across messages |
| Latency | `message.time.completed − time.created` (duration of the model call) |
| Errors | Failed tool calls (`part.state.status = 'error'`) plus `type='error'` parts |
| Context | Largest single-request context window used vs. the model's context limit |
| Realtime | Session/counts updated every ~4 s while the dashboard tab is visible |

A `notes` object inside every `/api/overview` response documents these assumptions in detail.

---

## API endpoints

Base URL: `http://127.0.0.1:8124` (dev server; the desktop app uses a random port - the frontend derives it from `window.location`, so no configuration is needed).

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Server + database health (`dbExists`, `dbSize`) |
| `GET /api/meta` | Server version, ranges, rate limits, context defaults |
| `GET /api/context` | Model → context-window map (`models`, `default`) |
| `GET /api/projects` | Real project directories found in the database |
| `GET /api/overview?range=7d` | Aggregates: requests, tokens, latency, success rate, stages, daily buckets, rate limits |
| `GET /api/models?range=7d` | Per-model aggregation incl. `contextLimit` / `contextUsed` |
| `GET /api/context_usage?range=7d` | Context window usage: latest request (input/cached/output/reasoning vs limit), peak, per-model/session/agent aggregates, recent requests, estimated composition of the latest request |
| `GET /api/budget` | Token Quota: estimated quota window usage (`window`: limit, hours, anchor hour, burn rate, projection, exhaustion ETA, reset time, hourly `series`) + calendar-day `today` and 14-day `history` |
| `GET /api/sessions?limit=50` | Session list (id, title, model, tokens, status, latency) |
| `GET /api/requests?limit=60` | Latest requests (id, model, agent, tokens, latency, status, time) |
| `GET /api/realtime` | Watermark + active sessions, RPM/TPM (last 1 min), quota-window requests/tokens |
| `GET /api/graph` | Knowledge graph from `graphify-out/graph.json` (see Knowledge Graph section below) |

`range` values: `today`, `7d`, `30d`, `90d` (calendar ranges, default `today`), `24h` (rolling window: now − 24 h), and `custom` (requires `from=YYYY-MM-DD&to=YYYY-MM-DD`, both inclusive; dates are clamped to today). Calendar boundaries use `TOKENMETRICS_TZ` (default: system local timezone; set it to pin an IANA zone such as `Asia/Jakarta`); the database itself stays UTC epoch ms.

**Project filter:** `overview`, `models`, `sessions`, `requests`, and `realtime` accept `?project=<directory>` (URL-encoded) to restrict results to a single project directory, e.g. `GET /api/overview?project=C:/Users/you/projects/my-app`. Use `GET /api/projects` to list valid values.

**Context usage:** `tokens.total == input + output + reasoning + cache.read` in the database, but no per-category attribution is stored, so the composition breakdown is an explicit **estimated** heuristic (splits only the real input total of the latest request across categories read from the workspace files; it never invents tokens). Everything else (window utilisation, peaks, aggregates) is actuals from the database.

**Token quota (Free-Tier Quota):** the opencode free tier grants roughly 2.5M tokens per ~14 h reset window; the dashboard models it as an estimated sliding window anchored at `QUOTA_ANCHOR_HOUR` (default 04:00 local, so the shift never happens at your off-midnight usage of the window; the anchor choice only changes where the reset lands). `TOKENMETRICS_QUOTA_TOKENS` (tokens per window) and `TOKENMETRICS_QUOTA_WINDOW_HOURS` pin the values (labelled `configured`); unset, defaults `2_500_000` / `14` are used and labelled `default`. The window is **estimated**: the reset is never claimed to be exact provider timing. Percentages are raw (not clamped to 100%). Status tiers (HEALTHY / WATCH / HIGH / CRITICAL / EXHAUSTION RISK) are dashboard interpretation thresholds on projected usage at reset, not provider rules. Calendar-day usage stays separate (`today` / `history`).

Responses are JSON, cached briefly server-side (overview 3 s, models 5 s, sessions/requests 2 s, realtime 1.5 s).

### Knowledge Graph section

The dashboard sidebar has a **Knowledge Graph** section that visualizes the codebase as an interactive mind-map backed by `graphify-out/graph.json` (kept fresh with `graphify update .`). Four views:

| View | Implementation |
| --- | --- |
| Graph | Native vis-network graph, nodes colored by graphify community (files = boxes) |
| Folders | Same graph aggregated by directory (`dir:` nodes), edge weights + relation summaries |
| File tree | Iframe to `graphify-out/views/tree.html` (`graphify tree`) |
| Call flow | Iframe to `graphify-out/views/callflow.html` (`graphify export callflow-html`) |

- The chosen view persists in `localStorage.graphView`; the graph re-renders on project change, refresh, and theme toggle.
- Regenerate the three HTML views after a graph rebuild with `py tools/graph_views.py`.
- `GET /api/graph?project=<dir>&refresh=1` returns `{ok, directed, mtime, nodes, links, views}`. The project filter keeps nodes whose `source_file` matches the repo root (any project inside it shows the whole graph) or the directory basename; unrelated projects return `0` nodes and the dashboard shows a "No matching nodes" hint. `refresh=1` bypasses the mtime cache.

---

## Configuration

**Desktop (`app\config.json`)** - created automatically next to `desktop.py` on first run: `dbPath` (default `~/.local/share/opencode/opencode.db`), `host`/`port` (default `127.0.0.1` / `0` = random free port), `width`/`height`/`minWidth`/`minHeight`.

**Dev server (`server.py`)** - constants live at the top of `server_app/config.py`:

| Constant | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8124` / `127.0.0.1` | Listen address (also `--port` / `--host`) |
| `DB_PATH` | `~/.local/share/opencode/opencode.db` | Real opencode database (read-only connection, WAL-safe) |
| `MODELS_CACHE` | `~/.cache/opencode/models.json` | Models.dev cache used for context-window limits |
| `MODEL_CONTEXT_OVERRIDES` | `ollama/qwen2.5-coder:7b` | Context limits for models missing from the models.dev cache (e.g. local ollama models) - add your own here |
| `DEFAULT_CONTEXT` | `200_000` | Fallback context limit when a model is unknown |
| `ACTIVE_WINDOW_MS` | `5 * 60_000` | Session counts as *active* if updated within 5 minutes |
| `TOKENMETRICS_RPM`, `TOKENMETRICS_TPM`, `TOKENMETRICS_RPD`, `TOKENMETRICS_DTP` | unset (falls back to estimates) | Verified quotas. OpenCode's local DB does not expose provider/account limits, so unset values use community estimates (`60` / `250000` / `200` / `2500000`, editable in `RATE_LIMIT_DEFAULTS`) and are labelled `Estimated default`; set a `TOKENMETRICS_*` env var to pin a verified limit (labelled `configured`). RPD/DTP track the estimated quota window, not a calendar day |
| `TOKENMETRICS_TZ` | system local time (unset) | Timezone for calendar day boundaries (`today`, per-day buckets, quota-window anchor). Set an IANA name to pin it (e.g. `Asia/Jakarta`). Requires Python 3.9+ (`zoneinfo`); older Pythons fall back to local time |
| `TOKENMETRICS_QUOTA_TOKENS` | `2_500_000` (`QUOTA_LIMIT_DEFAULT`) | Free-tier token quota per reset window for the Token Quota section; `configured` when set, otherwise `default` |
| `TOKENMETRICS_QUOTA_WINDOW_HOURS` | `14` (`QUOTA_WINDOW_HOURS`) | Estimated reset-window length for the Token Quota section |
| `QUOTA_ANCHOR_HOUR` | `4` | Local hour the estimated 14 h window starts on (reset lands at `anchor + 14h`; set to change where the reset lands) |
| `TOKENMETRICS_REQUEST_QUOTA` | `200` (`REQUEST_QUOTA_DEFAULT`) | Estimated request budget per quota window |
| `RANGES` | `today/7d/30d/90d` (+ `24h`, `custom`) | Aggregation windows and bucket counts |

KPI deltas and the efficiency baseline are computed from the immediately-prior window of the same length (`_prev_overview`), never from hardcoded constants.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Desktop window opens but shows "Graph unreachable" / API errors | Check the DB exists and is readable; set `dbPath` in `app\config.json` if your opencode database is elsewhere. |
| Desktop window fails with a WebView2 error | Install the Microsoft Edge WebView2 runtime (https://developer.microsoft.com/microsoft-edge/webview2/). |
| `pywebview` import error | `py -m pip install pywebview`. |
| "Server unreachable" banner | The embedded/dev server is down. Restart the app, or for the dev server run `py server.py`. |
| Wrong context limits for a model | Add the model id to `MODEL_CONTEXT_OVERRIDES` in `server_app/config.py` and restart. |
| Counts look small / zero | The current opencode user likely has few or no assistant messages in the selected range - try `90d`. |
| Port 8124 already in use | Pick another port with `--port`. |
| Graph section empty | Run `graphify update .` (or `graphify extract . --code-only`) and press Refresh in the dashboard. |

---

## Graphify (knowledge graph)

This repo is wired up for [graphify](https://github.com/Graphify-Labs/graphify): a knowledge graph of the codebase is kept in `graphify-out/` and consulted (and kept up to date) automatically by the opencode integration.

```bash
py tools/skill_install.py   # idempotent: installs CLI + skill, registers opencode hooks
```

What it does:

1. Ensures the CLI is available - `uv tool install graphifyy` (falls back to `pipx`, then `pip --user`).
2. Copies the OpenCode skill (`SKILL.md` + `references/`) into `SKILLS_DIR/graphify` (default `~/.config/opencode/skills`; override with the `OPENCODE_SKILLS_DIR` env var).
3. Runs `graphify opencode install`, which adds a section to `AGENTS.md` and registers a `.opencode/plugins/graphify.js` `tool.execute.before` hook + plugin entry in `.opencode/opencode.json`.

Useful commands:

```bash
graphify extract . --code-only   # build graphify-out/ with local AST only (no API cost)
graphify update .                # incremental refresh after edits
graphify query "<question>"      # scoped subgraph answer to a codebase question
graphify path "A" "B"            # shortest path between two nodes
graphify explain "X"             # plain-language explanation of a node
```
