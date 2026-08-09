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

Local (this repo):

```jsonc
// opencode.json
{
  "plugin": ["./opencode/plugins/token-metrics.js"]
}
```

Or from npm:

```bash
npm install opencode-token-metrics
```

```jsonc
{
  "plugin": ["opencode-token-metrics"]
}
```

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

The dashboard can read this file for live plugin data (planned post-v0.1.0);
today the dashboard reads `opencode.db` directly, so the plugin is an
independent realtime complement.

## Configuration (env vars)

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOKENMETRICS_STATE` | `~/.local/share/token-metrics/state.json` | Where `state.json` is written |
| `TOKENMETRICS_QUOTA_TOKENS` | `2500000` | Tokens per quota window (labelled `configured` when set) |
| `TOKENMETRICS_QUOTA_WINDOW_HOURS` | `14` | Quota-window length in hours |
| `TOKENMETRICS_QUOTA_ANCHOR_HOUR` | `4` | Local hour the window starts at |

## Behavior

- **Capture**: on `message.updated` for assistant messages carrying token data.
  Same message id updates in place (retries/edits don't double count).
- **Window**: sliding estimate anchored at `anchorHour`, re-derived on every event.
- **Toasts**: once per tier at 50 / 75 / 90 % (via `client.tui.showToast`).
- **Tool**: `token_metrics` (`detail` optional) returns a live text summary.
- Persistence is debounced (~750 ms) and atomic (temp file + rename); the plugin
  never writes to `opencode.db` and never throws.
