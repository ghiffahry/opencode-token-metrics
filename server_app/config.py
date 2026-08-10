"""Token Metrics - configuration, paths, rate limits and range definitions.

Constants and settings shared across the server_app package.
"""

import os
import sys
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8124
VERSION = "0.1.0"
AUTH_TOKEN = os.environ.get("TOKENMETRICS_AUTH_TOKEN", "")


def is_loopback(host):
    """True for loopback bind addresses (no auth needed)."""
    return host in ("127.0.0.1", "localhost", "::1") or str(host).startswith("127.")


def set_auth_token(token):
    """Set the API auth token at runtime (CLI --auth-token)."""
    global AUTH_TOKEN
    AUTH_TOKEN = token or ""


def _base_dir():
    """Web root for static dashboard assets.

    Resolution order:
    1. PyInstaller bundle -> extracted _MEIPASS dir.
    2. Python install -> the `web` package next to server_app (site-packages/web).
    3. Source checkout -> repo `web/` directory.
    """
    pkg = Path(__file__).resolve().parent
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    folder = pkg.parent / "web"
    if (folder / "index.html").is_file():
        return folder
    return pkg.parent


def _data_root():
    """Repo root for runtime data (graphify-out); _MEIPASS when frozen."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def log(msg):
    """Console-safe print (pythonw has no stdout)."""
    try:
        print(msg)
    except Exception:
        pass


BASE_DIR = _base_dir()
DB_PATH = Path.home() / ".local" / "share" / "opencode" / "opencode.db"


def db_path():
    """Current opencode database path (readable form of DB_PATH)."""
    return DB_PATH


def set_db_path(p):
    """Override the opencode database path (used by --db and desktop config)."""
    global DB_PATH
    DB_PATH = Path(p)
MODELS_CACHE = Path.home() / ".cache" / "opencode" / "models.json"
DATA_ROOT = _data_root()
GRAPH_JSON = DATA_ROOT / "graphify-out" / "graph.json"
GRAPH_VIEWS = DATA_ROOT / "graphify-out" / "views"

DEFAULT_CONTEXT = 200_000
ACTIVE_WINDOW_MS = 5 * 60_000          # session "active" if updated within 5 min
# Calendar analytics run in this timezone (IANA name). Database timestamps stay
# absolute epoch-ms; only calendar boundaries are computed in this tz.
# Defaults to the system local timezone; set TOKENMETRICS_TZ to pin an explicit
# IANA zone (e.g. Asia/Jakarta).
ANALYTICS_TZ = os.environ.get("TOKENMETRICS_TZ")
# Free-tier quota: NOT a calendar-day budget. The opencode free tier grants
# roughly 2.5M tokens per ~12-14h reset window; the dashboard models it as an
# estimated `QUOTA_WINDOW_HOURS` window anchored at a fixed local clock hour
# (never midnight) and every reset is labelled "Estimated" - the provider does
# not publish the exact reset timestamp. Set the matching TOKENMETRICS_* env
# var to pin a verified value (the UI then labels it "configured").
QUOTA_LIMIT_DEFAULT = 2_500_000
QUOTA_WINDOW_HOURS = 14
QUOTA_ANCHOR_HOUR = 4          # local hour the 14h windows drift from
REQUEST_QUOTA_DEFAULT = 200
# Fallback char/4 estimates for context categories the database never records.
CONTEXT_ESTIMATE_DEFAULTS = {"system_prompt": 3000, "tool_definitions": 2500}


def quota_config():
    """Free-tier quota knobs: (value, source) per setting.

    source is "configured" when a matching TOKENMETRICS_* env var is set,
    otherwise "default" - a labelled estimate, never a provider fact.
    TOKENMETRICS_QUOTA_TOKENS / TOKENMETRICS_DTP pin the token limit and
    TOKENMETRICS_REQUEST_QUOTA / TOKENMETRICS_RPD pin the request quota.
    """
    def _env(default, *names):
        for name in names:
            raw = os.environ.get("TOKENMETRICS_%s" % name)
            if raw is None:
                continue
            try:
                return int(raw), "configured"
            except ValueError:
                return default, "configured"
        return default, "default"
    limit, limit_source = _env(QUOTA_LIMIT_DEFAULT, "QUOTA_TOKENS", "DTP")
    hours, hours_source = _env(QUOTA_WINDOW_HOURS, "QUOTA_WINDOW_HOURS")
    anchor, _ = _env(QUOTA_ANCHOR_HOUR, "QUOTA_ANCHOR_HOUR")
    req, req_source = _env(REQUEST_QUOTA_DEFAULT, "REQUEST_QUOTA", "RPD")
    return {"limit": limit, "limitSource": limit_source,
            "hours": hours, "hoursSource": hours_source,
            "anchorHour": anchor, "requestLimit": req,
            "requestSource": req_source}


# The local database records usage, but never provider/account quotas. The
# per-minute limits below are community estimates; set the matching
# TOKENMETRICS_* env var to pin a verified value - the UI then labels the
# limit as "configured". rpd/dtp follow the free-tier quota window.
RATE_LIMIT_DEFAULTS = {"rpm": 60, "tpm": 250_000}


def _limit_for(name):
    value = os.environ.get("TOKENMETRICS_%s" % name.upper())
    if value is not None:
        try:
            return int(value), "configured"
        except ValueError:
            return None, "configured"
    return RATE_LIMIT_DEFAULTS.get(name), "default"


_QUOTA_CFG = quota_config()
RATE_LIMITS = {
    "rpm": _limit_for("rpm")[0],
    "tpm": _limit_for("tpm")[0],
    "rpd": _QUOTA_CFG["requestLimit"],
    "dtp": _QUOTA_CFG["limit"],
}
RATE_LIMIT_SOURCES = {
    "rpm": _limit_for("rpm")[1],
    "tpm": _limit_for("tpm")[1],
    "rpd": _QUOTA_CFG["requestSource"],
    "dtp": _QUOTA_CFG["limitSource"],
}

# Context-window overrides for models the models.dev cache does not describe
# (e.g. local ollama models). Add more entries as needed.
MODEL_CONTEXT_OVERRIDES = {
    "ollama/qwen2.5-coder:7b": 32_768,
}

RANGES = {
    # Calendar-based analytics periods: today + N previous calendar days,
    # boundaries computed in ANALYTICS_TZ (NOT rolling NOW - N*24h).
    "today": {"label": "Today", "kind": "calendar", "days_back": 0, "buckets": 24},
    "7d": {"label": "Last 7 days", "kind": "calendar", "days_back": 6, "buckets": 7},
    "30d": {"label": "Last 30 days", "kind": "calendar", "days_back": 29, "buckets": 30},
    "90d": {"label": "Last 90 days", "kind": "calendar", "days_back": 89, "buckets": 90},
    # Rolling operational window - explicitly NOT "Today".
    "24h": {"label": "Last 24 hours", "kind": "rolling", "ms": 86_400_000, "buckets": 24},
}

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

