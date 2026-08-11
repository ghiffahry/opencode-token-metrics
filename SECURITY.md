# Security Policy

## Security model

Token Metrics is a **local, read-only** observability tool:

- The dashboard opens the real `opencode.db` in read-only / WAL-safe mode and
  **never writes to it**.
- The HTTP server binds to **127.0.0.1 by default** and only serves the
  dashboard + `/api/*` endpoints.
- The opencode plugin writes a local `state.json` (default
  `~/.local/share/token-metrics/state.json`) and never touches `opencode.db`.
- All data stays on your machine; nothing is uploaded anywhere.

## Exposing the server (remote bind)

Binding to a non-loopback address (`--host 0.0.0.0`, LAN, or the internet) is
**opt-in and unsafe unless you authenticate it**. When the host is not
loopback, the server **auto-generates an auth token** (or honours
`TOKENMETRICS_AUTH_TOKEN` / `--auth-token`) and requires it on every `/api/*`
request via one of:

- `?token=<token>` query parameter
- `Authorization: Bearer <token>` header
- the `tm_auth` cookie (set automatically when the token is active)

The token is printed to the server console on startup when auto-generated.
Keep it secret; anyone holding it can read your usage data and local file
paths. Prefer a reverse proxy with TLS (e.g. Caddy/nginx) if you must expose
the dashboard beyond your machine.

The dashboard UI itself is designed for local use; serving `web/` to the
public internet is not supported.

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories:
https://github.com/ghiffahry/opencode-token-metrics/security/advisories/new

Include: affected version, reproduction steps, and impact. Do not open a
public issue for a vulnerability.

## What the plugin stores (privacy)

`state.json` contains, for each assistant message captured since the plugin
started: message id, session id, model/provider, token breakdown and cost;
plus per-session metadata (title, workspace directory, model). Message bodies
are **not** stored. Messages are capped at 5,000 entries and sessions are
pruned after the retention window (`TOKENMETRICS_RETENTION_DAYS`, default 30).
Clear everything with the plugin tool: `token_metrics` with `reset: true`.
