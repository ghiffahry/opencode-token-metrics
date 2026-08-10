import os
import sys
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8124
VERSION = "0.1.0"
AUTH_TOKEN = os.environ.get("TOKENMETRICS_AUTH_TOKEN", "")


def is_loopback(host):
    return host in ("127.0.0.1", "localhost", "::1") or str(host).startswith("127.")

def set_auth_token(token):
    global AUTH_TOKEN
    AUTH_TOKEN = token or ""

def _base_dir():
    pkg = Path(__file__).resolve().parent
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    folder = pkg.parent / "web"
    if (folder / "index.html").is_file():
        return folder
    return pkg.parent

def _data_root():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def log(msg):
    try:
        print(msg)
    except Exception:
        pass


BASE_DIR = _base_dir()
DB_PATH = Path.home() / ".local" / "share" / "opencode" / "opencode.db"


def db_path():
    return DB_PATH


def set_db_path(p):
    global DB_PATH
    DB_PATH = Path(p)
MODELS_CACHE = Path.home() / ".cache" / "opencode" / "models.json"
DATA_ROOT = _data_root()
GRAPH_JSON = DATA_ROOT / "graphify-out" / "graph.json"
GRAPH_VIEWS = DATA_ROOT / "graphify-out" / "views"

DEFAULT_CONTEXT = 200_000
ACTIVE_WINDOW_MS = 5 * 60_000          # session "active" if updated within 5 min
ANALYTICS_TZ = os.environ.get("TOKENMETRICS_TZ")
QUOTA_LIMIT_DEFAULT = 2_500_000
QUOTA_WINDOW_HOURS = 14
QUOTA_ANCHOR_HOUR = 4          # local hour the 14h windows drift from
REQUEST_QUOTA_DEFAULT = 200
CONTEXT_ESTIMATE_DEFAULTS = {"system_prompt": 3000, "tool_definitions": 2500}


def quota_config():
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

MODEL_CONTEXT_OVERRIDES = {
    "ollama/qwen2.5-coder:7b": 32_768,
}

RANGES = {
    "today": {"label": "Today", "kind": "calendar", "days_back": 0, "buckets": 24},
    "7d": {"label": "Last 7 days", "kind": "calendar", "days_back": 6, "buckets": 7},
    "30d": {"label": "Last 30 days", "kind": "calendar", "days_back": 29, "buckets": 30},
    "90d": {"label": "Last 90 days", "kind": "calendar", "days_back": 89, "buckets": 90},
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
