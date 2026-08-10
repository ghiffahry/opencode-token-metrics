"""Overview aggregation: KPIs, buckets, rate limits, prev-window deltas."""

import datetime

from ..config import ANALYTICS_TZ, RANGES, RATE_LIMITS, RATE_LIMIT_SOURCES
from ..db import msg_scope, part_scope, q
from ..ranges import (build_buckets, now_ms, prev_bounds, quota_window_bounds,
                      range_bounds, range_detail)
from ._empty import _empty_overview


def overview(range_key, project=None, model=None, from_date=None, to_date=None):
    cfg = RANGES.get(range_key)
    if range_key == "custom":
        cfg = {"label": "Custom", "kind": "custom", "buckets": 0}
    now = now_ms()
    start, end = range_bounds(range_key, from_date, to_date)
    if start is None:
        return _empty_overview("custom", project, from_date, to_date)
    prev_start, prev_end = prev_bounds(range_key, start, end, from_date, to_date)
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
    rpm = tpm = 0
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
        if ts >= min1:
            rpm += 1
            if r["time_completed"]:
                tpm += tin + tout

    # Quota-window usage (estimated 14h window, NOT the calendar day) for the
    # rpd/dtp rate-limit cards. The window is anchored independently of the
    # selected analytics range - it is a live provider-quota metric.
    wb = quota_window_bounds(now)
    win_rows = q("SELECT json_extract(data, '$.tokens.input') AS tokens_input, "
                 "json_extract(data, '$.tokens.output') AS tokens_output "
                 "FROM message WHERE time_created >= ? AND time_created < ? "
                 "AND json_extract(data, '$.role') = 'assistant' "
                 "AND json_extract(data, '$.modelID') IS NOT NULL" + m_sql,
                 (wb["start"], now) + m_par)
    win_req = len(win_rows)
    win_tokens = sum(int(r["tokens_input"] or 0) + int(r["tokens_output"] or 0)
                     for r in win_rows)

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
            "rpd": {"used": win_req, "limit": RATE_LIMITS["rpd"], "source": RATE_LIMIT_SOURCES["rpd"],
                    "hours": wb["hours"]},
            "dtp": {"used": win_tokens, "limit": RATE_LIMITS["dtp"], "source": RATE_LIMIT_SOURCES["dtp"],
                    "hours": wb["hours"]},
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
