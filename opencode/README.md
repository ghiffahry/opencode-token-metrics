# opencode-token-metrics

Realtime token usage & quota monitor for [opencode](https://opencode.ai). This
plugin captures assistant-message token usage from opencode events and writes a
small `state.json` with a per-session breakdown plus an estimated quota-window
summary. It also exposes a `token_metrics` tool so the agent can query live
usage itself, and can show a toast when usage crosses quota thresholds.

The window math mirrors the [Token Metrics dashboard](../README.md): an
estimated quota window (default 2.5M tokens per 14 h, anchored at 04:00 local),
so the numbers match what the dashboard shows. Resets are estimates, never exact
provider timing.

## Install

This directory is the npm package source (`opencode-token-metrics`). Install it
as a package for production, or point opencode at the local file while
developing. OpenCode also auto-scans `.opencode/plugins/` — copy the file there
if you prefer that convention.

Local (this repo, development):

```jsonc
// opencode.json
{
  "plugin": ["./opencode/plugins/token-metrics.js"]
}
```

Or from npm (production):

```bash
npm install opencode-token-metrics
```

```jsonc
{
  "plugin": ["opencode-token-metrics"]
}
```

## Compatibility

| OpenCode | Plugin API | Status |
| --- | --- | --- |
| v1.x (SDK `@opencode-ai/plugin` >= 1.18.15) | `message.updated`, `session.updated`, `tool`, `client.tui.showToast` | Tested target |

The plugin consumes the event schema shipped with
[`@opencode-ai/plugin`](https://www.npmjs.com/package/@opencode-ai/plugin)
(declared as a dependency and peer). The OpenCode plugin API is still beta and
can change between versions; before upgrading opencode, run
`npm test` and re-test against the actual installed opencode, not only the
local source.

## What it writes

`TOKENMETRICS_STATE` (default `~/.local/share/token-metrics/state.json`):

```jsonc
{
  "version": 1,
  "config": { "limit": 2500000, "hours": 14, "anchorHour": 4, "source": "default" },
  "sessions": {
    "sess_...": {
      "title": "…", "directory": "…", "model": "…",
      "messageIDs": ["…"], "messages": 12,
      "tokens": { "input": 0, "output": 0, "reasoning": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
      "cost": 0, "updated": 0
    }
  },
  "messages": {
    "msg_...": { "sessionID": "…", "model": "…", "provider": "…",
                 "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
                 "total": 0, "cost": 0, "time": 0 }
  },
  "window": {
    "start": 0, "end": 0, "anchorHour": 4, "hours": 14, "limit": 2500000,
    "source": "default", "tokens": 0, "requests": 0, "remaining": 2500000,
    "pct": 0, "burnRatePerHour": 0, "projectedAtReset": 0,
    "willExhaustBeforeReset": false, "status": "healthy"
  },
  "notified": {}
}
```

The dashboard reads this file for live plugin data via `GET /api/plugin_state`
(see the Status strip "Plugin (state.json)" item), complementing the
dashboard's direct reads of `opencode.db`.

## Configuration (env vars)

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOKENMETRICS_STATE` | `~/.local/share/token-metrics/state.json` | Where `state.json` is written |
| `TOKENMETRICS_QUOTA_TOKENS` | `2500000` | Tokens per quota window (labelled `configured` when set) |
| `TOKENMETRICS_QUOTA_WINDOW_HOURS` | `14` | Quota-window length in hours |
| `TOKENMETRICS_QUOTA_ANCHOR_HOUR` | `4` | Local hour the window starts at |
| `TOKENMETRICS_RETENTION_DAYS` | `30` | Sessions with no messages are dropped N days after `updated` |

## Behavior

- **Capture**: on `message.updated` for assistant messages carrying token data.
  Same message id updates in place (retries/edits don't double count).
- **Window**: sliding estimate anchored at `anchorHour`, re-derived on every
  event. Boundary math is shared with the dashboard
  (`opencode/plugins/quota.js` <-> `server_app/ranges.py`) and unit-tested.
- **Toasts**: once per tier at 50 / 75 / 90 % (via `client.tui.showToast`).
- **Tool**: `token_metrics` returns a live text summary; `detail=true` adds a
  per-session breakdown; `reset=true` clears captured state and starts over.
- **Retention**: message bodies are capped at 5,000 entries; sessions that hold
  no messages are pruned after `TOKENMETRICS_RETENTION_DAYS`.
- Persistence is debounced (~750 ms) and atomic (temp file + rename); the plugin
  never writes to `opencode.db` and never throws.

## Privacy

`state.json` stores, per assistant message: message id, session id, model and
provider, token breakdown and cost; per session: title, workspace directory and
model. Message **bodies are never stored**, nothing leaves your machine. Clear
everything at any time with the `token_metrics` tool (`reset: true`) or by
deleting the state file.
