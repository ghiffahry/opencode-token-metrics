#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Token Metrics - OpenCode local bridge.

Python-stdlib HTTP server that:
  1. Reads the real opencode SQLite database (read-only, WAL-safe)
     and exposes aggregate JSON endpoints under /api/*.
  2. Serves the dashboard (index.html, styles.css, script.js) at /
     so a single URL works: http://127.0.0.1:8124/

Run:  py server.py            (default port 8124)
      py server.py --port 9000
"""

import argparse
import datetime
import json
import mimetypes
import os
import sqlite3
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
MODELS_CACHE = Path.home() / ".cache" / "opencode" / "models.json"
GRAPH_JSON = BASE_DIR / "graphify-out" / "graph.json"
GRAPH_VIEWS = BASE_DIR / "graphify-out" / "views"

DEFAULT_CONTEXT = 200_000
ACTIVE_WINDOW_MS = 5 * 60_000          # session "active" if updated within 5 min
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
    "1d": {"label": "Last 24 hours", "ms": 86_400_000, "buckets": 24},
    "7d": {"label": "Last 7 days", "ms": 7 * 86_400_000, "buckets": 7},
    "30d": {"label": "Last 30 days", "ms": 30 * 86_400_000, "buckets": 30},
    "90d": {"label": "Last 90 days", "ms": 90 * 86_400_000, "buckets": 90},
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

_cache = {}   # key -> (expires_at, payload)


def now_ms():
    return int(time.time() * 1000)


def day_start_ms(ts):
    d = datetime.datetime.fromtimestamp(ts / 1000)
    return int(datetime.datetime(d.year, d.month, d.day).timestamp() * 1000)


def cache_get_or(key, ttl, fn, force=False):
    if not force:
        hit = _cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
    value = fn()
    _cache[key] = (time.time() + ttl, value)
    return value


def connect():
    con = sqlite3.connect("file:%s?mode=ro" % DB_PATH, uri=True)
    con.execute("PRAGMA query_only=ON")
    con.row_factory = sqlite3.Row
    return con


def q(sql, params=()):
    con = connect()
    try:
        return con.execute(sql, params).fetchall()
    finally:
        con.close()


def model_providers():
    """bare model id -> provider, derived from the models.dev cache."""
    try:
        mtime = MODELS_CACHE.stat().st_mtime
    except OSError:
        return {}
    entry = _cache.get("providers")
    if entry and entry[0] == mtime:
        return entry[1]
    prov = {}
    try:
        data = json.loads(MODELS_CACHE.read_text(encoding="utf-8"))
        for provider, pv in data.items():
            if not isinstance(pv, dict):
                continue
            models = pv.get("models") if isinstance(pv.get("models"), dict) else pv
            for mid in models:
                prov.setdefault(mid, provider)
    except Exception:
        pass
    _cache["providers"] = (mtime, prov)
    return prov


_modelid_map_key = None
_modelid_map_value = None


def _modelid_map():
    """Resolved model key -> set(raw message modelIDs).

    One scan over the message table (rebuilt only when the DB or models.dev
    cache changes) serves every model filter; callers that previously ran a
    full-scan query per call now do an O(1) lookup.
    """
    global _modelid_map_key, _modelid_map_value
    try:
        key = (DB_PATH.stat().st_mtime,
               MODELS_CACHE.stat().st_mtime if MODELS_CACHE.exists() else None)
    except OSError:
        key = None
    if _modelid_map_value is not None and _modelid_map_key == key:
        return _modelid_map_value
    out = {}
    rows = q("SELECT DISTINCT s.model AS sm, json_extract(m.data, '$.modelID') AS mid "
             "FROM message m JOIN session s ON m.session_id = s.id "
             "WHERE json_extract(m.data, '$.role') = 'assistant' "
             "AND json_extract(m.data, '$.modelID') IS NOT NULL")
    for sm, mid in rows:
        if not mid:
            continue
        out.setdefault(message_model(sm, mid), set()).add(mid)
    _modelid_map_key = key
    _modelid_map_value = out
    return out


def _modelid_candidates(model):
    """Raw message modelID values whose resolved key equals `model`."""
    if not model or model in ("", "(unknown)", "all", "unknown"):
        return []
    cands = _modelid_map().get(model)
    return sorted(cands) if cands else []


def _msg_model_cond(model, col="data"):
    """WHERE fragment matching a message's modelID column to a normalized key.

    Messages are attributed by their own modelID (message-level), so sessions
    that switched models contribute to each model they actually used.
    """
    if not model or model in ("", "(unknown)", "all"):
        return "", ()
    if model == "unknown":
        return ("(json_extract(" + col + ", '$.modelID') IS NULL "
                "OR json_extract(" + col + ", '$.modelID') = '')", ())
    cands = _modelid_candidates(model)
    if not cands:
        return "(1=0)", ()
    ph = ",".join("?" * len(cands))
    return "json_extract(" + col + ", '$.modelID') IN (" + ph + ")", cands


def session_scope(project, model=None, tbl=None):
    """WHERE fragment for the session table restricted to directory + model.

    A session matches a model when it contains at least one assistant message
    produced by that model (message-level attribution). `tbl` prefixes
    columns when the session table is aliased (e.g. "s").
    """
    col = lambda name: ("%s.%s" % (tbl, name)) if tbl else name
    parts, params = [], []
    if project:
        parts.append(col("directory") + " = ?")
        params.append(project)
    cond, cpar = _msg_model_cond(model)
    if cond:
        parts.append(col("id") + " IN (SELECT session_id FROM message WHERE " + cond + ")")
        params.extend(cpar)
    if not parts:
        return "", ()
    return " AND " + " AND ".join(parts), tuple(params)


def msg_scope(project, model=None):
    """WHERE fragment for the message table restricted to directory + model."""
    parts, params = [], []
    if project:
        parts.append("session_id IN (SELECT id FROM session WHERE directory = ?)")
        params.append(project)
    cond, cpar = _msg_model_cond(model)
    if cond:
        parts.append(cond)
        params.extend(cpar)
    if not parts:
        return "", ()
    return " AND " + " AND ".join(parts), tuple(params)


def part_scope(project, model=None):
    """WHERE fragment for the part table (errors) restricted to directory + model.

    Parts are attributed through their parent message's modelID.
    """
    parts, params = [], []
    if project:
        parts.append("session_id IN (SELECT id FROM session WHERE directory = ?)")
        params.append(project)
    cond, cpar = _msg_model_cond(model)
    if cond:
        parts.append("message_id IN (SELECT id FROM message WHERE " + cond + ")")
        params.extend(cpar)
    if not parts:
        return "", ()
    return " AND " + " AND ".join(parts), tuple(params)


def parse_model(raw):
    if not raw:
        return "unknown"
    if isinstance(raw, dict):
        d = raw
    else:
        try:
            d = json.loads(raw)
        except Exception:
            return str(raw)
    pid = d.get("providerID") or ""
    mid = d.get("id") or d.get("modelID") or ""
    if not mid:
        return pid or "unknown"
    if not pid:
        return mid
    return "%s/%s" % (pid, mid)


def message_model(session_raw, message_raw):
    """Resolve the model used by a message, not merely the session default."""
    mid = str(message_raw or "").strip()
    if not mid:
        return parse_model(session_raw)
    if "/" in mid:
        return mid
    provider = model_providers().get(mid)
    if not provider:
        session_key = parse_model(session_raw)
        provider = session_key.split("/", 1)[0] if "/" in session_key else ""
    return "%s/%s" % (provider, mid) if provider else mid


def load_context_map():
    ctx = {}
    try:
        data = json.loads(MODELS_CACHE.read_text(encoding="utf-8"))
        for provider, pv in data.items():
            if not isinstance(pv, dict):
                continue
            models = pv.get("models") if isinstance(pv.get("models"), dict) else pv
            for mid, mv in models.items():
                if not isinstance(mv, dict):
                    continue
                limit = (mv.get("limit") or {}).get("context")
                if limit:
                    ctx["%s/%s" % (provider, mid)] = int(limit)
                    ctx[mid] = int(limit)
    except Exception:
        pass
    for k, v in MODEL_CONTEXT_OVERRIDES.items():
        ctx[k] = v
    return ctx


def context_for(key, limits=None):
    limits = limits if limits is not None else load_context_map()
    return limits.get(key, limits.get(key.split("/", 1)[-1], DEFAULT_CONTEXT))


def msg_duration_seconds(data):
    try:
        d = json.loads(data)
    except Exception:
        return None
    comp = (d.get("time") or {}).get("completed")
    created = (d.get("time") or {}).get("created")
    if not comp or not created or comp <= created:
        return None
    return (comp - created) / 1000.0


def build_buckets(range_key, cutoff, token_rows):
    """Bucket message token rows by hour (1d) or day, plus request counts."""
    cfg = RANGES[range_key]
    n = cfg["buckets"]
    now = now_ms()

    if range_key == "1d":
        buckets = [
            {"label": datetime.datetime.fromtimestamp(
                (now - (n - 1 - i) * 3600_000) / 1000).strftime("%H:%M"),
             "requests": 0, "input": 0, "output": 0}
            for i in range(n)
        ]

        def slot(ts):
            return int((ts - (now - n * 3600_000)) / 3600_000)

        for r in token_rows:
            i = slot(r["time_created"])
            if 0 <= i < n:
                buckets[i]["requests"] += 1
                buckets[i]["input"] += int(r["tokens_input"] or 0)
                buckets[i]["output"] += int(r["tokens_output"] or 0)
        return buckets

    days = []
    for i in range(n):
        d = datetime.date.fromtimestamp((now - (n - 1 - i) * 86_400_000) / 1000)
        days.append((d, {"label": d.strftime("%b %d"), "requests": 0, "input": 0, "output": 0}))
    day_index = {d: i for i, (d, _) in enumerate(days)}

    for r in token_rows:
        d = datetime.date.fromtimestamp(r["time_created"] / 1000)
        i = day_index.get(d)
        if i is not None:
            days[i][1]["requests"] += 1
            days[i][1]["input"] += int(r["tokens_input"] or 0)
            days[i][1]["output"] += int(r["tokens_output"] or 0)

    return [b for _, b in days]


def overview(range_key, project=None, model=None):
    cfg = RANGES[range_key]
    ms = cfg["ms"]
    now = now_ms()
    cutoff = now - ms
    day_start = day_start_ms(now)
    min1 = now - 60_000
    m_sql, m_par = msg_scope(project, model)
    p_sql, p_par = part_scope(project, model)

    # One message scan over [cutoff - ms, now) yields both the current window
    # and the prior window (`_prev_overview`), instead of ~9 separate scans
    # that each re-parsed the same JSON columns. Only extracted columns are
    # transferred - never the full `data` blobs.
    rows = q(
        "SELECT time_created, "
        "json_extract(data, '$.tokens.input') AS tokens_input, "
        "json_extract(data, '$.tokens.output') AS tokens_output, "
        "json_extract(data, '$.tokens.reasoning') AS tokens_reasoning, "
        "json_extract(data, '$.tokens.cache.read') AS tokens_cache_read, "
        "json_extract(data, '$.cost') AS cost, "
        "json_extract(data, '$.agent') AS agent, "
        "json_extract(data, '$.time.completed') AS time_completed, "
        "json_extract(data, '$.time.created') AS time_created_msg "
        "FROM message WHERE time_created >= ? AND time_created < ? "
        "AND json_extract(data, '$.role') = 'assistant' "
        "AND json_extract(data, '$.modelID') IS NOT NULL" + m_sql,
        (cutoff - ms, now) + m_par)
    cur_rows, prev_rows = [], []
    for r in rows:
        (prev_rows if r["time_created"] < cutoff else cur_rows).append(r)

    err_rows = q("SELECT time_created FROM part WHERE time_created >= ? AND time_created < ? AND ("
                 "json_extract(data, '$.type') = 'error' OR "
                 "(json_extract(data, '$.type') = 'tool' "
                 "AND json_extract(data, '$.state.status') = 'error'))" + p_sql,
                 (cutoff - ms, now) + p_par)

    input_t = output_t = reasoning_t = cache_t = 0
    cost = 0.0
    requests = 0
    durations = []
    stage_agg = {}
    today_req = today_tokens = rpm = tpm = 0
    for r in cur_rows:
        tin = int(r["tokens_input"] or 0)
        tout = int(r["tokens_output"] or 0)
        input_t += tin
        output_t += tout
        reasoning_t += int(r["tokens_reasoning"] or 0)
        cache_t += int(r["tokens_cache_read"] or 0)
        cost += float(r["cost"] or 0)
        requests += 1
        tc, tm = r["time_completed"], r["time_created_msg"]
        if tc and tm and tc > tm:
            durations.append((tc - tm) / 1000.0)
        agent = r["agent"] or "unknown"
        g = stage_agg.setdefault(agent, {"input": 0, "output": 0})
        g["input"] += tin
        g["output"] += tout
        ts = r["time_created"]
        if ts >= day_start:
            today_req += 1
            today_tokens += tin + tout
        if ts >= min1:
            rpm += 1
            if r["time_completed"]:
                tpm += tin + tout

    prev_input = prev_output = prev_requests = 0
    prev_durations = []
    for r in prev_rows:
        tin = int(r["tokens_input"] or 0)
        tout = int(r["tokens_output"] or 0)
        prev_input += tin
        prev_output += tout
        prev_requests += 1
        tc, tm = r["time_completed"], r["time_created_msg"]
        if tc and tm and tc > tm:
            prev_durations.append((tc - tm) / 1000.0)

    latency = (sum(durations) / len(durations)) * 1000 if durations else 0
    prev_latency = (sum(prev_durations) / len(prev_durations)) * 1000 if prev_durations else 0
    errors = sum(1 for r in err_rows if r["time_created"] >= cutoff)
    prev_errors = len(err_rows) - errors
    success = max(0, requests - errors)
    prev_success = max(0, prev_requests - prev_errors)

    buckets = build_buckets(range_key, cutoff, cur_rows)
    stages = [{"name": k, "input": v["input"], "output": v["output"]}
              for k, v in stage_agg.items()]

    table_rows = buckets
    if range_key == "1d":
        table_rows = [{
            "label": "Today",
            "requests": sum(b["requests"] for b in buckets),
            "input": sum(b["input"] for b in buckets),
            "output": sum(b["output"] for b in buckets),
        }]

    return {
        "source": "opencode",
        "range": range_key,
        "project": project,
        "rangeLabel": cfg["label"],
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "requests": requests,
        "success": success,
        "errors": errors,
        "successRate": (success / requests * 100) if requests else 0,
        "input": input_t,
        "output": output_t,
        "reasoning": reasoning_t,
        "cacheRead": cache_t,
        "total": input_t + output_t,
        "cost": cost,
        "latency": round(latency),
        "avgIn": round(input_t / requests) if requests else 0,
        "avgOut": round(output_t / requests) if requests else 0,
        "ratio": (output_t / input_t) if input_t else 0,
        "stages": stages,
        "buckets": buckets,
        "tableRows": table_rows,
        "rateLimits": {
            "rpm": {"used": rpm, "limit": RATE_LIMITS["rpm"], "source": RATE_LIMIT_SOURCES["rpm"]},
            "tpm": {"used": tpm, "limit": RATE_LIMITS["tpm"], "source": RATE_LIMIT_SOURCES["tpm"]},
            "rpd": {"used": today_req, "limit": RATE_LIMITS["rpd"], "source": RATE_LIMIT_SOURCES["rpd"]},
            "dtp": {"used": today_tokens, "limit": RATE_LIMITS["dtp"], "source": RATE_LIMIT_SOURCES["dtp"]},
        },
        "prev": {
            "requests": prev_requests,
            "success": prev_success,
            "errors": prev_errors,
            "successRate": (prev_success / prev_requests * 100) if prev_requests else 0,
            "input": prev_input,
            "output": prev_output,
            "total": prev_input + prev_output,
            "latency": round(prev_latency),
            "avgIn": round(prev_input / prev_requests) if prev_requests else 0,
            "avgOut": round(prev_output / prev_requests) if prev_requests else 0,
            "ratio": (prev_output / prev_input) if prev_input else 0,
        },
        "notes": {"latency": "estimate from message completed-created duration",
                  "errors": "failed tool calls + 'error' parts (estimate)",
                  "requests": "assistant messages = model API calls"},
    }


def models(range_key, project=None, model=None):
    cfg = RANGES[range_key]
    cutoff = now_ms() - cfg["ms"]
    limits = load_context_map()
    proj_sql = " AND s.directory = ?" if project else ""
    proj_par = (project,) if project else ()
    msg_where = ("m.time_created >= ? AND json_extract(m.data, '$.role') = 'assistant' "
                 "AND json_extract(m.data, '$.modelID') IS NOT NULL")

    sess_rows = q("SELECT s.model, m.session_id AS sid, "
                  "json_extract(m.data, '$.tokens.input') AS tokens_input, "
                  "json_extract(m.data, '$.tokens.output') AS tokens_output, "
                  "json_extract(m.data, '$.tokens.reasoning') AS tokens_reasoning, "
                  "json_extract(m.data, '$.tokens.cache.read') AS tokens_cache_read, "
                  "json_extract(m.data, '$.cost') AS cost, "
                  "m.time_created AS time_updated, "
                  "json_extract(m.data, '$.modelID') AS message_model "
                  "FROM message m JOIN session s ON m.session_id = s.id "
                  "WHERE " + msg_where + proj_sql,
                  (cutoff,) + proj_par)
    req_rows = q("SELECT s.model AS session_model, json_extract(m.data, '$.modelID') AS message_model, count(*) AS c FROM message m "
                 "JOIN session s ON m.session_id = s.id "
                 "WHERE " + msg_where + proj_sql
                 + " GROUP BY s.model, message_model", (cutoff,) + proj_par)
    err_rows = q("SELECT s.model AS session_model, json_extract(m.data, '$.modelID') AS message_model, count(*) AS c FROM part p "
                 "JOIN message m ON m.id = p.message_id "
                 "JOIN session s ON m.session_id = s.id "
                 "WHERE p.time_created >= ? AND ("
                 "json_extract(p.data, '$.type') = 'error' OR "
                 "(json_extract(p.data, '$.type') = 'tool' "
                 "AND json_extract(p.data, '$.state.status') = 'error'))"
                 " AND json_extract(m.data, '$.role') = 'assistant' "
                 "AND json_extract(m.data, '$.modelID') IS NOT NULL" + proj_sql
                 + " GROUP BY s.model, message_model", (cutoff,) + proj_par)
    ctx_rows = q("SELECT s.model AS session_model, json_extract(m.data, '$.modelID') AS message_model, max(json_extract(m.data, '$.tokens.total')) AS c "
                 "FROM message m JOIN session s ON m.session_id = s.id "
                 "WHERE " + msg_where + " AND json_extract(m.data, '$.tokens.total') IS NOT NULL"
                 + proj_sql + " GROUP BY s.model, message_model", (cutoff,) + proj_par)
    lat_rows = q("SELECT s.model AS session_model, json_extract(m.data, '$.modelID') AS message_model, m.data AS data FROM message m "
                 "JOIN session s ON m.session_id = s.id "
                 "WHERE " + msg_where + " AND json_extract(m.data, '$.time.completed') IS NOT NULL"
                 + proj_sql, (cutoff,) + proj_par)

    agg = {}
    sessions_seen = {}
    for s in sess_rows:
        key = message_model(s["model"], s["message_model"])
        g = agg.setdefault(key, {"input": 0, "output": 0, "cache": 0, "reasoning": 0,
                                 "cost": 0, "sessions": 0, "lastSeen": 0})
        g["input"] += int(s["tokens_input"] or 0)
        g["output"] += int(s["tokens_output"] or 0)
        g["cache"] += int(s["tokens_cache_read"] or 0)
        g["reasoning"] += int(s["tokens_reasoning"] or 0)
        g["cost"] += float(s["cost"] or 0)
        if s["sid"]:
            seen = sessions_seen.setdefault(key, set())
            if s["sid"] not in seen:
                seen.add(s["sid"])
                g["sessions"] += 1
        g["lastSeen"] = max(g["lastSeen"], int(s["time_updated"] or 0))

    requests = {}
    for r in req_rows:
        k = message_model(r["session_model"], r["message_model"])
        requests[k] = requests.get(k, 0) + r["c"]
        agg.setdefault(k, {"input": 0, "output": 0, "cache": 0, "reasoning": 0,
                           "cost": 0, "sessions": 0, "lastSeen": 0})

    errors = {}
    for r in err_rows:
        k = message_model(r["session_model"], r["message_model"])
        errors[k] = errors.get(k, 0) + r["c"]

    ctx_used = {}
    for r in ctx_rows:
        k = message_model(r["session_model"], r["message_model"])
        if k not in ctx_used or r["c"] > ctx_used[k]:
            ctx_used[k] = r["c"]

    lat_by_model = {}
    for r in lat_rows:
        d = msg_duration_seconds(r["data"])
        if d:
            lat_by_model.setdefault(message_model(r["session_model"], r["message_model"]), []).append(d)

    active_cutoff = now_ms() - ACTIVE_WINDOW_MS
    out = []
    for key, g in agg.items():
        requests_k = int(requests.get(key, 0))
        errors_k = int(errors.get(key, 0))
        success_k = max(0, requests_k - errors_k)
        rate = (success_k / requests_k * 100) if requests_k else 100
        if requests_k and rate < 90:
            status = "Limited"
        elif g["lastSeen"] >= active_cutoff:
            status = "Active"
        else:
            status = "Idle"

        durs = lat_by_model.get(key, [])
        latency = (sum(durs) / len(durs)) * 1000 if durs else 0
        limit = context_for(key, limits)
        used = int(ctx_used.get(key, 0) or 0)
        used = min(used, limit) if limit else used

        out.append({
            "id": key,
            "name": key,
            "short": key.split("/")[-1],
            "sessions": g["sessions"],
            "requests": requests_k,
            "input": g["input"],
            "output": g["output"],
            "cacheRead": g["cache"],
            "reasoning": g["reasoning"],
            "cost": g["cost"],
            "errors": errors_k,
            "success": success_k,
            "successRate": rate,
            "latency": round(latency),
            "status": status,
            "contextLimit": limit,
            "contextUsed": used,
            "lastSeen": g["lastSeen"],
        })
    out.sort(key=lambda m: m["input"] + m["output"], reverse=True)
    if model and model not in ("all", "(unknown)"):
        out = [item for item in out if item["id"] == model]
    return {"models": out, "range": range_key, "project": project, "model": model,
            "defaultContext": DEFAULT_CONTEXT}


def sessions(limit=20, project=None, model=None):
    m_sql, m_par = msg_scope(project, model)
    frag, par = session_scope(project, model)
    rows = q("SELECT * FROM session WHERE 1=1" + frag + " "
             "ORDER BY time_updated DESC LIMIT ?", par + (limit,))
    active_cutoff = now_ms() - ACTIVE_WINDOW_MS
    lat_rows = q("SELECT session_id AS sid, data FROM message "
                 "WHERE json_extract(data, '$.time.completed') IS NOT NULL" + m_sql, m_par)
    lat_by_session = {}
    for r in lat_rows:
        d = msg_duration_seconds(r["data"])
        if d:
            lat_by_session.setdefault(r["sid"], []).append(d)

    # Each session's model = the model that produced its latest assistant message.
    last_model = {}
    for r in q("SELECT s.id AS sid, s.model AS session_model, "
               "json_extract(m.data, '$.modelID') AS message_model "
               "FROM message m JOIN session s ON m.session_id = s.id "
               "WHERE json_extract(m.data, '$.role') = 'assistant' "
               "AND json_extract(m.data, '$.modelID') IS NOT NULL "
               "AND m.time_created = (SELECT MAX(m2.time_created) FROM message m2 "
               "WHERE m2.session_id = m.session_id "
               "AND json_extract(m2.data, '$.role') = 'assistant' "
               "AND json_extract(m2.data, '$.modelID') IS NOT NULL)"):
        last_model[r["sid"]] = message_model(r["session_model"], r["message_model"])

    out = []
    for s in rows:
        sid = s["id"]
        durs = lat_by_session.get(sid, [])
        latency = (sum(durs) / len(durs)) * 1000 if durs else 0
        out.append({
            "id": sid,
            "title": s["title"] or "(untitled)",
            "agent": s["agent"] or "unknown",
            "model": last_model.get(sid) or parse_model(s["model"]),
            "input": int(s["tokens_input"] or 0),
            "output": int(s["tokens_output"] or 0),
            "reasoning": int(s["tokens_reasoning"] or 0),
            "cacheRead": int(s["tokens_cache_read"] or 0),
            "cost": float(s["cost"] or 0),
            "latency": round(latency),
            "status": "active" if s["time_updated"] >= active_cutoff else "idle",
            "timeCreated": int(s["time_created"] or 0),
            "timeUpdated": int(s["time_updated"] or 0),
        })
    return {"sessions": out}


def requests_list(limit=50, project=None, model=None):
    frag, par = _msg_model_cond(model, col="m.data")
    par = tuple(par)
    if frag:
        frag = " AND " + frag
    if project:
        rows = q("SELECT m.id, m.session_id, m.time_created, s.agent, s.model, m.data "
                 "FROM message m JOIN session s ON m.session_id = s.id "
                 "WHERE json_extract(m.data, '$.role') = 'assistant' "
                 "AND json_extract(m.data, '$.modelID') IS NOT NULL AND s.directory = ?" + frag
                 + " ORDER BY m.time_created DESC LIMIT ?", (project,) + par + (limit,))
    else:
        rows = q("SELECT m.id, m.session_id, m.time_created, s.agent, s.model, m.data "
                 "FROM message m JOIN session s ON m.session_id = s.id "
                 "WHERE json_extract(m.data, '$.role') = 'assistant' "
                 "AND json_extract(m.data, '$.modelID') IS NOT NULL" + frag
                 + " ORDER BY m.time_created DESC LIMIT ?", par + (limit,))
    out = []
    for r in rows:
        try:
            d = json.loads(r["data"])
        except Exception:
            continue
        t = d.get("tokens") or {}
        comp = (d.get("time") or {}).get("completed")
        created = (d.get("time") or {}).get("created")
        dur = ((comp - created) / 1000) if (comp and created and comp > created) else 0
        model = message_model(r["model"], d.get("modelID"))
        out.append({
            "id": r["id"],
            "modelId": model,
            "model": model,
            "agent": r["agent"] or (d.get("agent") or "unknown"),
            "input": int(t.get("input") or 0),
            "output": int(t.get("output") or 0),
            "cacheRead": int((t.get("cache") or {}).get("read") or 0),
            "reasoning": int(t.get("reasoning") or 0),
            "total": int(t.get("input") or 0) + int(t.get("output") or 0),
            "latency": round(dur * 1000),
            "status": "error" if d.get("finish") == "error" else "success",
            "time": int(r["time_created"]),
        })
    return {"requests": out}


def realtime(project=None, model=None):
    now = now_ms()
    min1 = now - 60_000
    today = day_start_ms(now)
    limits = load_context_map()
    m_sql, m_par = msg_scope(project, model)

    watermark_row = q("SELECT id FROM event ORDER BY id DESC LIMIT 1")
    watermark = watermark_row[0]["id"] if watermark_row else ""

    today_requests = q("SELECT 1 FROM message WHERE time_created >= ? "
                       "AND json_extract(data, '$.role') = 'assistant' "
                       "AND json_extract(data, '$.modelID') IS NOT NULL" + m_sql,
                       (today,) + m_par)
    today_tokens = q("SELECT json_extract(data, '$.tokens.input') AS tokens_input, "
                     "json_extract(data, '$.tokens.output') AS tokens_output, "
                     "json_extract(data, '$.tokens.cache.read') AS tokens_cache_read "
                     "FROM message WHERE time_created >= ? "
                     "AND json_extract(data, '$.role') = 'assistant'"
                     + m_sql, (today,) + m_par)
    rpm = q("SELECT 1 FROM message WHERE time_created >= ? "
            "AND json_extract(data, '$.role') = 'assistant' "
            "AND json_extract(data, '$.modelID') IS NOT NULL" + m_sql, (min1,) + m_par)
    tpm_rows = q("SELECT data FROM message WHERE time_created >= ? "
                 "AND json_extract(data, '$.role') = 'assistant' "
                 "AND json_extract(data, '$.time.completed') IS NOT NULL" + m_sql,
                 (min1,) + m_par)
    tpm = 0
    for r in tpm_rows:
        try:
            t = (json.loads(r["data"]).get("tokens") or {})
            tpm += int(t.get("input") or 0) + int(t.get("output") or 0)
        except Exception:
            pass

    sess = sessions(20, project, model)["sessions"]
    active = [s for s in sess if s["status"] == "active"]
    for s in sess:
        s["contextLimit"] = context_for(s["model"], limits)
        s["contextUsed"] = min(s["input"], s["contextLimit"])

    return {
        "watermark": watermark,
        "activeSessions": len(active),
        "requestsLastMinute": len(rpm),
        "tokensLastMinute": tpm,
        "today": {
            "requests": len(today_requests),
            "input": sum(int(r["tokens_input"] or 0) for r in today_tokens),
            "output": sum(int(r["tokens_output"] or 0) for r in today_tokens),
            "cacheRead": sum(int(r["tokens_cache_read"] or 0) for r in today_tokens),
            "tokens": sum(int(r["tokens_input"] or 0) + int(r["tokens_output"] or 0) for r in today_tokens),
        },
        "sessions": sess,
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def api_context():
    limits = load_context_map()
    return {"models": limits, "default": DEFAULT_CONTEXT}


def api_meta():
    return {
        "source": "opencode",
        "db": str(DB_PATH),
        "modelsCache": str(MODELS_CACHE) if MODELS_CACHE.exists() else None,
        "ranges": {k: {"label": v["label"]} for k, v in RANGES.items()},
        "rateLimits": RATE_LIMITS,
        "rateLimitSources": RATE_LIMIT_SOURCES,
        "activeWindowMs": ACTIVE_WINDOW_MS,
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def api_health():
    db_exists = DB_PATH.is_file()
    db_readable = db_exists and os.access(str(DB_PATH), os.R_OK)
    return {
        "ok": db_readable,
        "db": str(DB_PATH),
        "dbExists": db_exists,
        "dbReadable": db_readable,
        "dataSource": "opencode.sqlite" if db_readable else "unavailable",
        "dbSize": DB_PATH.stat().st_size if db_exists else 0,
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def api_projects():
    rows = q("SELECT COALESCE(NULLIF(s.directory, ''), '(unknown)') AS directory, "
             "COUNT(*) AS sessions, MAX(s.time_updated) AS lastActivity, "
             "MIN(s.time_created) AS firstActivity FROM session s "
             "GROUP BY directory ORDER BY lastActivity DESC")
    pd_map = {}
    for r in q("SELECT project_id, directory, type FROM project_directory"):
        pd_map.setdefault(r["directory"], []).append(r["project_id"])
    proj_map = {}
    for r in q("SELECT id, worktree, name FROM project"):
        proj_map[r["id"]] = {"worktree": r["worktree"], "name": r["name"]}

    out = []
    for r in rows:
        dir_ = r["directory"]
        pids = pd_map.get(dir_) or []
        first = proj_map.get(pids[0]) if pids else None
        out.append({
            "id": dir_,
            "directory": dir_,
            "name": (first and (first["name"] or first["worktree"])) or dir_,
            "worktree": (first or {}).get("worktree"),
            "sessions": r["sessions"],
            "firstActivity": r["firstActivity"],
            "lastActivity": r["lastActivity"],
        })
    return {"projects": out}


def api_graph(project, force=False):
    """Serve the graphify knowledge graph (graphify-out/graph.json).

    Nodes/links are optionally restricted to one project directory by
    matching the node's source_file prefix. The JSON is cached by file
    mtime so graphify rebuilds are picked up without a server restart.
    """
    if not GRAPH_JSON.is_file():
        return {
            "ok": False,
            "error": "graph.json not found",
            "hint": "run: graphify extract . --code-only",
        }
    key = "graph:%s" % GRAPH_JSON.stat().st_mtime
    raw = _cache.get(key)
    if force or not raw or raw[0] <= time.time():
        try:
            data = json.loads(GRAPH_JSON.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            return {"ok": False, "error": str(e)}
        raw = (
            time.time() + 15,
            {
                "directed": bool(data.get("directed", True)),
                "mtime": GRAPH_JSON.stat().st_mtime,
                "nodes": data.get("nodes", []),
                "links": data.get("links", []),
            },
        )
        _cache[key] = raw
    nodes = raw[1]["nodes"]
    links = raw[1]["links"]
    if project:
        proj = project.replace("\\", "/").rstrip("/").lower()
        base = str(BASE_DIR).replace("\\", "/").rstrip("/").lower()
        keep_all = proj == base or base.startswith(proj + "/")
        if not keep_all:
            proj_base = proj.rsplit("/", 1)[-1]
            keep = {
                n["id"]
                for n in nodes
                if ("/%s/" % proj_base) in ("/%s/" % (n.get("source_file") or "").replace("\\", "/"))
            }
        else:
            keep = None
        if keep is not None:
            nodes = [n for n in nodes if n["id"] in keep]
            links = [
                l for l in links if l.get("source") in keep and l.get("target") in keep
            ]
    return {
        "ok": True,
        "directed": raw[1]["directed"],
        "mtime": raw[1]["mtime"],
        "nodes": nodes,
        "links": links,
        "views": sorted(
            (p.name for p in GRAPH_VIEWS.glob("*.html")) if GRAPH_VIEWS.is_dir() else []
        ),
    }


def _empty_buckets(range_key):
    """Zero-filled bucket list with the same labels as build_buckets."""
    cfg = RANGES[range_key]
    n = cfg["buckets"]
    now = now_ms()
    if range_key == "1d":
        return [
            {"label": datetime.datetime.fromtimestamp(
                (now - (n - 1 - i) * 3600_000) / 1000).strftime("%H:%M"),
             "requests": 0, "input": 0, "output": 0}
            for i in range(n)
        ]
    return [
        {"label": datetime.date.fromtimestamp(
            (now - (n - 1 - i) * 86_400_000) / 1000).strftime("%b %d"),
         "requests": 0, "input": 0, "output": 0}
        for i in range(n)
    ]


def _empty_overview(range_key, project=None):
    """overview() shape with all values zeroed (used when the DB is missing)."""
    cfg = RANGES[range_key]
    buckets = _empty_buckets(range_key)
    table_rows = [{
        "label": "Today", "requests": 0, "input": 0, "output": 0,
    }] if range_key == "1d" else buckets
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
    rng = query.get("range", ["7d"])[0]
    if rng not in RANGES:
        rng = "7d"
    if path == "/api/overview":
        return _empty_overview(rng, project)
    if path == "/api/models":
        return {"models": [], "range": rng, "project": project,
                "defaultContext": DEFAULT_CONTEXT}
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
            "today": {"requests": 0, "input": 0, "output": 0,
                      "cacheRead": 0, "tokens": 0},
            "sessions": [],
            "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    if path == "/api/projects":
        return {"projects": []}
    return None


def handle_api(path, query):
    project = (query.get("project") or [None])[0]
    project = project if project else None
    model = (query.get("model") or [None])[0]
    model = model if model else None

    if not DB_PATH.exists():
        empty = _empty_payload(path, query, project)
        if empty is not None:
            return empty

    if path == "/api/health":
        return api_health()
    if path == "/api/meta":
        return api_meta()
    if path == "/api/context":
        return api_context()
    if path == "/api/projects":
        return cache_get_or("projects", 5, api_projects)

    if path == "/api/graph":
        force = query.get("refresh", ["0"])[0] in ("1", "true", "yes")
        return api_graph(project, force=force)

    if path == "/api/overview":
        rng = query.get("range", ["7d"])[0]
        if rng not in RANGES:
            rng = "7d"
        ttl = 5 if not model else 15
        return cache_get_or("overview:%s:%s:%s" % (rng, project, model), ttl,
                            lambda: overview(rng, project, model))

    if path == "/api/models":
        rng = query.get("range", ["7d"])[0]
        if rng not in RANGES:
            rng = "7d"
        return cache_get_or("models:%s:%s:%s" % (rng, project, model), 5,
                            lambda: models(rng, project, model))

    if path == "/api/sessions":
        try:
            limit = max(1, min(100, int(query.get("limit", ["20"])[0])))
        except Exception:
            limit = 20
        return cache_get_or("sessions:%s:%s" % (project, model), 2,
                            lambda: sessions(limit, project, model))

    if path == "/api/requests":
        try:
            limit = max(1, min(200, int(query.get("limit", ["50"])[0])))
        except Exception:
            limit = 50
        return cache_get_or("requests:%s:%s" % (project, model), 2,
                            lambda: requests_list(limit, project, model))

    if path == "/api/realtime":
        return cache_get_or("realtime:%s:%s" % (project, model), 1.5,
                            lambda: realtime(project, model))

    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "TokenMetrics/1.0"

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def do_OPTIONS(self):
        self._send(200, b"", "text/plain")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/api/"):
            try:
                payload = handle_api(path, query)
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
                return
            if payload is None:
                self._json(404, {"ok": False, "error": "unknown endpoint"})
                return
            self._json(200, payload)
            return

        # Static dashboard files
        if path in ("/", "/index.html"):
            path = "/index.html"
        elif path.startswith("/.."):
            self._send(403, b"forbidden", "text/plain")
            return

        rel = path.lstrip("/")
        if not rel:
            rel = "index.html"
        file_path = (BASE_DIR / rel).resolve()
        if not str(file_path).startswith(str(BASE_DIR.resolve())) or not file_path.is_file():
            self._send(404, b"not found", "text/plain")
            return

        ext = file_path.suffix.lower()
        ctype = STATIC_TYPES.get(ext, mimetypes.guess_type(str(file_path))[0] or "application/octet-stream")
        try:
            body = file_path.read_bytes()
        except OSError as e:
            self._send(500, str(e).encode("utf-8"), "text/plain; charset=utf-8")
            return
        self._send(200, body, ctype)

    def log_message(self, fmt, *args):
        return


def make_server(host=HOST, port=PORT):
    """Bind and return a started ThreadingHTTPServer.

    port 0 -> OS picks a free port (returned as the second element).
    Compatible with embedding (desktop.py) and the CLI.
    """
    srv = ThreadingHTTPServer((host, port), Handler)
    actual = srv.server_address[1]
    log("=" * 58)
    log("Token Metrics - OpenCode bridge")
    log("  DB       : %s" % DB_PATH)
    log("  UI       : http://%s:%d/" % (host, actual))
    log("  API      : http://%s:%d/api/health" % (host, actual))
    log("=" * 58)
    return srv, actual


def main():
    ap = argparse.ArgumentParser(description="OpenCode Token Metrics bridge server")
    ap.add_argument("--port", type=int, default=PORT, help="listen port (default %d)" % PORT)
    ap.add_argument("--host", default=HOST, help="bind address (default %s)" % HOST)
    ap.add_argument("--db", default=None, help="override opencode database path")
    args = ap.parse_args()

    if args.db:
        globals()["DB_PATH"] = Path(args.db)

    srv, _ = make_server(args.host, args.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("\nStopping server.")
        srv.shutdown()


if __name__ == "__main__":
    main()
