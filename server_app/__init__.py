"""Token Metrics - OpenCode local bridge (split package).

Importing this package exposes the same public API the former single-file
`server.py` did, so `import server` (desktop.py, tools/) keeps working.
"""

from .cache import _cache, cache_get_or
from .config import (
    ACTIVE_WINDOW_MS,
    ANALYTICS_TZ,
    BASE_DIR,
    CONTEXT_ESTIMATE_DEFAULTS,
    DAILY_BUDGET_DEFAULT,
    DB_PATH,
    DEFAULT_CONTEXT,
    GRAPH_JSON,
    GRAPH_VIEWS,
    HOST,
    MODELS_CACHE,
    MODEL_CONTEXT_OVERRIDES,
    PORT,
    RANGES,
    RATE_LIMITS,
    RATE_LIMIT_SOURCES,
    STATIC_TYPES,
    db_path,
    log,
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
from .httpd import Handler, main, make_server
from .overview import _empty_overview, _empty_payload, models, overview, realtime, requests_list, sessions
from .ranges import (
    build_buckets,
    day_start_ms,
    now_ms,
    parse_custom_day,
    prev_bounds,
    range_bounds,
    range_detail,
    tz_offset_str,
    tzinfo,
)

__all__ = [
    "ACTIVE_WINDOW_MS", "ANALYTICS_TZ", "BASE_DIR", "CONTEXT_ESTIMATE_DEFAULTS",
    "DAILY_BUDGET_DEFAULT", "DB_PATH", "DEFAULT_CONTEXT", "GRAPH_JSON",
    "GRAPH_VIEWS", "HOST", "Handler", "MODELS_CACHE", "MODEL_CONTEXT_OVERRIDES",
    "PORT", "RANGES", "RATE_LIMITS", "RATE_LIMIT_SOURCES", "STATIC_TYPES",
    "build_buckets", "cache_get_or", "connect", "context_for",
    "context_usage", "daily_budget", "db_path", "day_start_ms",
    "estimate_composition", "load_context_map", "log", "main", "make_server",
    "message_model", "model_providers", "models", "msg_duration_seconds",
    "msg_scope", "now_ms", "overview", "parse_custom_day", "parse_model",
    "part_scope", "prev_bounds", "q", "range_bounds", "range_detail",
    "realtime", "requests_list", "session_scope", "sessions", "set_db_path",
    "tz_offset_str", "tzinfo",
]
