"""Activity endpoints: overview, models, sessions, requests and realtime."""

import datetime
import json

from .config import (ACTIVE_WINDOW_MS, ANALYTICS_TZ, DAILY_BUDGET_DEFAULT,
                     DEFAULT_CONTEXT, RANGES, RATE_LIMITS, RATE_LIMIT_SOURCES)
from .db import (context_for, load_context_map, message_model, msg_duration_seconds,
                 msg_scope, parse_model, part_scope, q, session_scope, _msg_model_cond)
from .ranges import (_ts_local, build_buckets, day_start_ms, now_ms,
                     prev_bounds, range_bounds, range_detail)

def overview(range_key, project=None, model=None, from_date=None, to_date=None):
    cfg = RANGES.get(range_key)
    if range_key == "custom":
        cfg = {"label": "Custom", "kind": "custom", "buckets": 0}
    now = now_ms()
    start, end = range_bounds(range_key, from_date, to_date)
    if start is None:
        return _empty_overview("custom", project, from_date, to_date)
    prev_start, prev_end = prev_bounds(range_key, start, end, from_date, to_date)
    day_start = day_start_ms(now)
    min1 = now - 60_000
    m_sql, m_par = msg_scope(project, model)
    p_sql, p_par = part_scope(project, model)

    # One message scan over [prev_start, end) yields both the current window
    # and the prior window (`prev`), instead of ~9 separate scans that each
    # re-parsed the same JSON columns. Only extracted columns are transferred -
    # never the full `data` blobs.
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
        (prev_start, end) + m_par)
    cur_rows, prev_rows = [], []
    for r in rows:
        (prev_rows if r["time_created"] < start else cur_rows).append(r)

    err_rows = q("SELECT time_created FROM part WHERE time_created >= ? AND time_created < ? AND ("
                 "json_extract(data, '$.type') = 'error' OR "
                 "(json_extract(data, '$.type') = 'tool' "
                 "AND json_extract(data, '$.state.status') = 'error'))" + p_sql,
                 (prev_start, end) + p_par)

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
    errors = sum(1 for r in err_rows if r["time_created"] >= start)
    prev_errors = len(err_rows) - errors
    success = max(0, requests - errors)
    prev_success = max(0, prev_requests - prev_errors)

    buckets = build_buckets(range_key, start, end, cur_rows)
    stages = [{"name": k, "input": v["input"], "output": v["output"]}
              for k, v in stage_agg.items()]

    table_rows = buckets
    if range_key == "today":
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
        "rangeDetail": range_detail(range_key, start, end),
        "timezone": ANALYTICS_TZ,
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


def models(range_key, project=None, model=None, from_date=None, to_date=None):
    cfg = RANGES.get(range_key, RANGES["today"])
    start, end = range_bounds(range_key, from_date, to_date)
    if start is None:
        return {"models": [], "range": range_key, "project": project, "model": model,
                "defaultContext": DEFAULT_CONTEXT}
    cutoff = start
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
        return {"today": {"requests": 0, "input": 0, "output": 0, "cacheRead": 0, "tokens": 0},
                "config": {"target": DAILY_BUDGET_DEFAULT, "source": "default",
                           "note": "default estimate - set TOKENMETRICS_DAILY_BUDGET to pin a value"},
                "projectedToday": 0, "remaining": DAILY_BUDGET_DEFAULT, "pct": 0,
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
            "today": {"requests": 0, "input": 0, "output": 0,
                      "cacheRead": 0, "tokens": 0},
            "sessions": [],
            "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    if path == "/api/projects":
        return {"projects": []}
    return None



