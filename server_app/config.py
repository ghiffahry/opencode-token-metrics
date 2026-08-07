"""Token Metrics - configuration, paths, rate limits and range definitions.

Constants and settings shared across the server_app package.
"""

import os
import sys
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8124


def _base_dir():
    """Project root; when frozen by PyInstaller use the bundle temp dir."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


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
GRAPH_JSON = BASE_DIR / "graphify-out" / "graph.json"
GRAPH_VIEWS = BASE_DIR / "graphify-out" / "views"

DEFAULT_CONTEXT = 200_000
ACTIVE_WINDOW_MS = 5 * 60_000          # session "active" if updated within 5 min
# Calendar analytics run in this timezone (IANA name). Database timestamps stay
# absolute epoch-ms; only calendar boundaries are computed in this tz.
ANALYTICS_TZ = os.environ.get("TOKENMETRICS_TZ", "Asia/Jakarta")
# Daily budget target used by /api/budget when TOKENMETRICS_DAILY_BUDGET is unset.
DAILY_BUDGET_DEFAULT = 400_000
# Fallback char/4 estimates for context categories the database never records.
CONTEXT_ESTIMATE_DEFAULTS = {"system_prompt": 3000, "tool_definitions": 2500}
# The local database records usage, but never provider/account quotas. The
# opencode free tier does not publish limits (dynamic, per-IP, reset ~00:00
# local); the defaults below are community estimates (~200 req/day and
# ~0.3-0.5M tokens/day). Set the matching TOKENMETRICS_* env var to pin a
# verified value - the UI then labels the limit as "configured".
RATE_LIMIT_DEFAULTS = {"rpm": 60, "tpm": 250_000, "rpd": 200, "dtp": 400_000}


def _limit_for(name):
    value = os.environ.get("TOKENMETRICS_%s" % name.upper())
    if value is not None:
        try:
            return int(value), "configured"
        except ValueError:
            return None, "configured"
    return RATE_LIMIT_DEFAULTS.get(name), "default"


RATE_LIMITS = {}
RATE_LIMIT_SOURCES = {}
for _name in RATE_LIMIT_DEFAULTS:
    RATE_LIMITS[_name], RATE_LIMIT_SOURCES[_name] = _limit_for(_name)

# Context-window overrides for models the models.dev cache does not describe
# (e.g. local ollama models). Add more entries as needed.
MODEL_CONTEXT_OVERRIDES = {
    "ollama/qwen2.5-coder:7b": 32_768,
    "ollama/gleidsonnunes/Claude-Sonnet-4.6:latest": 200_000,
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

