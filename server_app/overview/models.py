"""Per-model usage aggregation for /api/models."""

from ..config import ACTIVE_WINDOW_MS, DEFAULT_CONTEXT, RANGES
from ..db import (context_for, load_context_map, message_model,
                  msg_duration_seconds, q)
from ..ranges import now_ms, range_bounds


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
