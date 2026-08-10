"""Zero-filled payloads used when the opencode database file is missing."""

import datetime

from ..config import (ANALYTICS_TZ, DEFAULT_CONTEXT, RANGES, RATE_LIMITS,
                      RATE_LIMIT_SOURCES, quota_config)
from ..ranges import build_buckets, now_ms, range_bounds, range_detail


def _empty_buckets(range_key, start=None, end=None):
    """Zero-filled bucket list with the same labels as build_buckets."""
    now = now_ms()
    if start is None or end is None:
        start, end = range_bounds(range_key)
    return build_buckets(range_key, start, end, [])


def _empty_overview(range_key, project=None, from_date=None, to_date=None):
    """overview() shape with all values zeroed (used when the DB is missing)."""
    cfg = RANGES.get(range_key, RANGES["today"])
    start, end = range_bounds(range_key, from_date, to_date)
    if start is None:
        start, end = now_ms(), now_ms()
    buckets = _empty_buckets(range_key, start, end)
    table_rows = [{
        "label": "Today", "requests": 0, "input": 0, "output": 0,
    }] if range_key == "today" else buckets
    empty = {
        "requests": 0, "success": 0, "errors": 0, "successRate": 0,
        "input": 0, "output": 0, "reasoning": 0, "cacheRead": 0,
        "total": 0, "cost": 0, "latency": 0, "avgIn": 0, "avgOut": 0,
        "ratio": 0, "stages": [], "buckets": buckets, "tableRows": table_rows,
    }
    return {
        "source": "opencode",
        "range": range_key,
        "project": project,
        "rangeLabel": cfg["label"],
        "rangeDetail": range_detail(range_key, start, end) if start != end else "",
        "timezone": ANALYTICS_TZ,
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "rateLimits": {k: {"used": 0, "limit": v, "source": RATE_LIMIT_SOURCES[k]}
                       for k, v in RATE_LIMITS.items()},
        "prev": dict(empty),
        "notes": {"requests": "assistant messages = model API calls",
                  "errors": "failed tool calls + 'error' parts (estimate)",
                  "latency": "estimate from message completed-created duration"},
        **empty,
    }


def _empty_payload(path, query, project):
    """Path-appropriate empty payload when the database file is missing."""
    rng = query.get("range", ["today"])[0]
    if rng not in RANGES and rng != "custom":
        rng = "today"
    from_date = (query.get("from") or [None])[0]
    to_date = (query.get("to") or [None])[0]
    if path == "/api/overview":
        return _empty_overview(rng, project, from_date, to_date)
    if path == "/api/models":
        return {"models": [], "range": rng, "project": project,
                "defaultContext": DEFAULT_CONTEXT}
    if path == "/api/context_usage":
        return {"range": rng, "latest": None, "peak": None, "byModel": [],
                "bySession": [], "byAgent": [], "byDay": [], "requests": [],
                "composition": None, "counts": {"requests": 0}}
    if path == "/api/budget":
        qc = quota_config()
        return {
            "window": {"limit": qc["limit"], "hours": qc["hours"], "anchorHour": qc["anchorHour"],
                       "source": qc["limitSource"], "estimated": True, "start": 0, "end": 0,
                       "resetAt": 0, "used": 0, "remaining": qc["limit"], "pct": 0,
                       "requests": 0, "requestLimit": qc["requestLimit"], "requestPct": 0,
                       "elapsedHours": 0, "hoursRemaining": qc["hours"],
                       "burnRate": None, "projectedAtReset": None, "projectedPct": None,
                       "timeToExhaustionMs": None, "willExhaustBeforeReset": False,
                       "status": "healthy", "series": []},
            "today": {"requests": 0, "input": 0, "output": 0, "cacheRead": 0, "tokens": 0},
            "config": {"target": qc["limit"], "source": qc["limitSource"],
                       "note": "estimated free-tier quota - set TOKENMETRICS_QUOTA_TOKENS to pin a value"},
            "history": [], "timezone": ANALYTICS_TZ,
            "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    if path == "/api/sessions":
        return {"sessions": []}
    if path == "/api/requests":
        return {"requests": []}
    if path == "/api/realtime":
        return {
            "watermark": "",
            "activeSessions": 0,
            "requestsLastMinute": 0,
            "tokensLastMinute": 0,
            "window": {"start": 0, "end": 0, "resetAt": 0, "requests": 0,
                       "input": 0, "output": 0, "cacheRead": 0, "tokens": 0},
            "sessions": [],
            "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    if path == "/api/projects":
        return {"projects": []}
    return None
