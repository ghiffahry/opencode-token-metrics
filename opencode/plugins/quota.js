// Pure quota-window helpers shared by the plugin and its tests.
//
// Kept dependency-free (node builtins only) and side-effect free so the
// tests can import them without an opencode host. The window math mirrors
// server_app/ranges.py::quota_window_bounds exactly; keep both in sync.

export const DEFAULTS = { limit: 2_500_000, hours: 14, anchorHour: 4 };

export function quotaConfig(env = process.env) {
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const limit = num(env.TOKENMETRICS_QUOTA_TOKENS, DEFAULTS.limit);
  const hours = num(env.TOKENMETRICS_QUOTA_WINDOW_HOURS, DEFAULTS.hours);
  const anchorHour = num(env.TOKENMETRICS_QUOTA_ANCHOR_HOUR, DEFAULTS.anchorHour);
  return {
    limit,
    hours,
    anchorHour,
    source: env.TOKENMETRICS_QUOTA_TOKENS ? "configured" : "default",
  };
}

// Window [start, end) like the dashboard: boundaries fall at
// anchorHour + k*hours (e.g. 04:00 and 18:00 for 14h at anchor 4).
// Uses floor division like the Python implementation so `now` is always
// inside the returned window - a naive single `if (end <= now) end += ms`
// still returns the PREVIOUS window for most of the second half of the
// cycle (the bug this fixes).
export function windowBounds(now, cfg) {
  const d = new Date(now);
  const at = new Date(d);
  at.setHours(cfg.anchorHour, 0, 0, 0);
  const ms = cfg.hours * 3600_000;
  const k = Math.floor((now - at.getTime()) / ms);
  const start = at.getTime() + k * ms;
  return { start, end: start + ms };
}

export function sumTokens(t) {
  if (!t) return 0;
  return (t.input || 0) + (t.output || 0) + (t.reasoning || 0) +
    (t.cache?.read || 0) + (t.cache?.write || 0);
}

export function statusFor(pct, willExhaust) {
  if (willExhaust || pct >= 100) return "exhaustion";
  if (pct >= 90) return "critical";
  if (pct >= 75) return "high";
  if (pct >= 50) return "watch";
  return "healthy";
}

export const fmtNum = (n) => Math.round(n).toLocaleString("en-US");

export const fmtCompact = (n) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(Math.round(n));
};

export const fmtDuration = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
