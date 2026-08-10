"""Token Metrics - local bridge package (split across submodules).

Importing this package exposes the public API used by the desktop app,
the tools/ scripts, and the HTTP server (server_app.httpd).
"""

from .cache import _cache, cache_get_or
from .config import (
    ACTIVE_WINDOW_MS,
    ANALYTICS_TZ,
    BASE_DIR,
    CONTEXT_ESTIMATE_DEFAULTS,
    DB_PATH,
    DEFAULT_CONTEXT,
    GRAPH_JSON,
    GRAPH_VIEWS,
    HOST,
    MODELS_CACHE,
    MODEL_CONTEXT_OVERRIDES,
    PORT,
    QUOTA_ANCHOR_HOUR,
    QUOTA_LIMIT_DEFAULT,
    QUOTA_WINDOW_HOURS,
    RANGES,
    RATE_LIMITS,
    RATE_LIMIT_SOURCES,
    REQUEST_QUOTA_DEFAULT,
    STATIC_TYPES,
    VERSION,
    db_path,
    log,
    quota_config,
    set_db_path,
)
from .context import context_usage, daily_budget
from .db import (
    connect,
    context_for,
    load_context_map,
    message_model,
    model_providers,
    msg_duration_seconds,
    msg_scope,
    parse_model,
    part_scope,
    q,
    session_scope,
)
from .estimates import estimate_composition
from .overview import _empty_overview, _empty_payload, models, overview, realtime, requests_list, sessions
from .plugin_state import plugin_state, state_path
from .ranges import (
    build_buckets,
    day_start_ms,
    now_ms,
    parse_custom_day,
    prev_bounds,
    quota_window_bounds,
    range_bounds,
    range_detail,
    tz_offset_str,
    tzinfo,
)

__all__ = [
    "ACTIVE_WINDOW_MS", "ANALYTICS_TZ", "BASE_DIR", "CONTEXT_ESTIMATE_DEFAULTS",
    "DB_PATH", "DEFAULT_CONTEXT", "GRAPH_JSON",
    "GRAPH_VIEWS", "HOST", "MODELS_CACHE", "MODEL_CONTEXT_OVERRIDES",
    "PORT", "QUOTA_ANCHOR_HOUR", "QUOTA_LIMIT_DEFAULT", "QUOTA_WINDOW_HOURS",
    "RANGES", "RATE_LIMITS", "RATE_LIMIT_SOURCES", "REQUEST_QUOTA_DEFAULT",
    "STATIC_TYPES", "VERSION",
    "build_buckets", "cache_get_or", "connect", "context_for",
    "context_usage", "daily_budget", "db_path", "day_start_ms",
    "estimate_composition", "load_context_map", "log",
    "message_model", "model_providers", "models", "msg_duration_seconds",
    "msg_scope", "now_ms", "overview", "parse_custom_day", "parse_model",
    "part_scope", "plugin_state", "prev_bounds", "q", "quota_config", "quota_window_bounds",
    "range_bounds", "range_detail",
    "realtime", "requests_list", "session_scope", "sessions", "set_db_path",
    "state_path", "tz_offset_str", "tzinfo",
]
