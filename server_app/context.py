"""Context-usage and daily-budget endpoints."""

import datetime
import os

from .config import ANALYTICS_TZ, DAILY_BUDGET_DEFAULT, RANGES
from .db import context_for, load_context_map, message_model, msg_scope, q
from .estimates import estimate_composition
from .ranges import _ts_local, build_buckets, day_start_ms, now_ms, range_bounds, range_detail

def context_usage(range_key, project=None, model=None, from_date=None, to_date=None):
    """Per-request context-window observability from the actual stored tokens.

    Every request row carries the provider-reported totals (input, cached,
    output, reasoning, total) plus the model's context limit, so the UI can
    render a truthful utilisation bar without estimating anything. Category
    composition is never fabricated here - it is a labelled estimate built
    by estimate_composition() and marked `estimated`.
    """
    cfg = RANGES.get(range_key, RANGES["today"])
    start, end = range_bounds(range_key, from_date, to_date)
    if start is None:
        return {"range": range_key, "latest": None, "peak": None, "byModel": [],
                "bySession": [], "byAgent": [], "byDay": [], "requests": [],
                "composition": None, "counts": {"requests": 0}}
    limits = load_context_map()
    m_sql, m_par = msg_scope(project, model)
    rows = q(
        "SELECT m.id, m.session_id, m.time_created, s.agent, s.model AS session_model, "
        "s.title AS session_title, s.directory, "
        "json_extract(m.data, '$.modelID') AS message_model, "
        "json_extract(m.data, '$.tokens.input') AS ti, "
        "json_extract(m.data, '$.tokens.output') AS to_, "
        "json_extract(m.data, '$.tokens.reasoning') AS tr, "
        "json_extract(m.data, '$.tokens.cache.read') AS tcr, "
        "json_extract(m.data, '$.tokens.total') AS tt "
        "FROM message m JOIN session s ON m.session_id = s.id "
        "WHERE m.time_created >= ? AND m.time_created < ? "
        "AND json_extract(m.data, '$.role') = 'assistant' "
        "AND json_extract(m.data, '$.modelID') IS NOT NULL" + m_sql,
        (start, end) + m_par)

    reqs = []
    by_model = {}
    by_session = {}
    by_agent = {}
    day_rows = []
    for r in rows:
        model_key = message_model(r["session_model"], r["message_model"])
        limit = context_for(model_key, limits)
        total = int(r["tt"] or 0)
        cached = int(r["tcr"] or 0)
        input_ = int(r["ti"] or 0)
        output_ = int(r["to_"] or 0)
        reasoning = int(r["tr"] or 0)
        pct = (total / limit * 100) if limit else 0
        item = {
            "id": r["id"], "sessionId": r["session_id"], "sessionTitle": r["session_title"],
            "model": model_key, "agent": r["agent"] or "unknown", "time": int(r["time_created"]),
            "input": input_, "cached": cached, "output": output_, "reasoning": reasoning,
            "total": total, "contextLimit": limit,
            "pct": round(pct, 1), "remaining": max(0, limit - total),
            "directory": r["directory"],
        }
        reqs.append(item)
        day_rows.append({"time_created": item["time"], "tokens_input": input_,
                         "tokens_output": output_})

        g = by_model.setdefault(model_key, {"id": model_key, "requests": 0, "input": 0, "cached": 0,
                                            "output": 0, "reasoning": 0, "maxTotal": 0,
                                            "contextLimit": limit, "lastSeen": 0})
        g["requests"] += 1
        g["input"] += input_
        g["cached"] += cached
        g["output"] += output_
        g["reasoning"] += reasoning
        g["maxTotal"] = max(g["maxTotal"], total)
        g["lastSeen"] = max(g["lastSeen"], item["time"])

        g = by_session.setdefault(r["session_id"], {"id": r["session_id"], "title": r["session_title"],
                                                    "requests": 0, "input": 0, "cached": 0,
                                                    "output": 0, "reasoning": 0, "maxTotal": 0,
                                                    "lastSeen": 0, "growth": []})
        g["requests"] += 1
        g["input"] += input_
        g["cached"] += cached
        g["output"] += output_
        g["reasoning"] += reasoning
        g["maxTotal"] = max(g["maxTotal"], total)
        g["lastSeen"] = max(g["lastSeen"], item["time"])
        if len(g["growth"]) < 40:
            g["growth"].append({"input": input_, "cached": cached,
                                "output": output_, "reasoning": reasoning})

        g = by_agent.setdefault(item["agent"], {"id": item["agent"], "requests": 0, "input": 0, "cached": 0,
                                                "output": 0, "reasoning": 0, "maxTotal": 0,
                                                "lastSeen": 0})
        g["requests"] += 1
        g["input"] += input_
        g["cached"] += cached
        g["output"] += output_
        g["reasoning"] += reasoning
        g["maxTotal"] = max(g["maxTotal"], total)
        g["lastSeen"] = max(g["lastSeen"], item["time"])

    for g in by_model.values():
        g["pct"] = round(g["maxTotal"] / g["contextLimit"] * 100, 1) if g["contextLimit"] else 0
        g["remaining"] = max(0, g["contextLimit"] - g["maxTotal"])
    by_model = sorted(by_model.values(), key=lambda x: x["maxTotal"], reverse=True)
    by_session = sorted(by_session.values(), key=lambda x: x["maxTotal"], reverse=True)
    by_agent = sorted(by_agent.values(), key=lambda x: x["maxTotal"], reverse=True)
    for g in by_session:
        g["growth"] = g["growth"][:40]

    reqs.sort(key=lambda x: x["time"])
    nonzero = [r for r in reqs if r["total"] > 0]
    latest = (nonzero[-1] if nonzero else reqs[-1]) if reqs else None
    peak = max(reqs, key=lambda x: x["total"]) if reqs else None

    composition = None
    if latest:
        composition = estimate_composition(latest.get("directory"), latest["input"] + latest["cached"], latest)

    buckets = build_buckets(range_key, start, end, day_rows)

    return {
        "range": range_key,
        "rangeLabel": cfg["label"],
        "rangeDetail": range_detail(range_key, start, end),
        "timezone": ANALYTICS_TZ,
        "latest": latest,
        "peak": peak,
        "byModel": by_model,
        "bySession": by_session,
        "byAgent": by_agent,
        "byDay": buckets,
        "requests": reqs[-300:][::-1],
        "composition": composition,
        "counts": {"requests": len(reqs)},
    }


def daily_budget(project=None, model=None):
    """Today's usage vs a configured daily token budget + 14-day history."""
    now = now_ms()
    today = day_start_ms(now)
    hist_start = day_start_ms(now - 13 * 86_400_000)
    m_sql, m_par = msg_scope(project, model)

    today_rows = q("SELECT json_extract(data, '$.tokens.input') AS tokens_input, "
                   "json_extract(data, '$.tokens.output') AS tokens_output, "
                   "json_extract(data, '$.tokens.cache.read') AS tokens_cache_read "
                   "FROM message WHERE time_created >= ? AND time_created < ? "
                   "AND json_extract(data, '$.role') = 'assistant' "
                   "AND json_extract(data, '$.modelID') IS NOT NULL" + m_sql,
                   (today, now) + m_par)
    today_req = len(today_rows)
    today_tokens = sum(int(r["tokens_input"] or 0) + int(r["tokens_output"] or 0) for r in today_rows)
    today_cache = sum(int(r["tokens_cache_read"] or 0) for r in today_rows)
    today_input = sum(int(r["tokens_input"] or 0) for r in today_rows)
    today_output = today_tokens - today_input

    hist_rows = q("SELECT time_created, "
                  "json_extract(data, '$.tokens.input') AS tokens_input, "
                  "json_extract(data, '$.tokens.output') AS tokens_output "
                  "FROM message WHERE time_created >= ? AND time_created < ? "
                  "AND json_extract(data, '$.role') = 'assistant' "
                  "AND json_extract(data, '$.modelID') IS NOT NULL" + m_sql,
                  (hist_start, now) + m_par)

    days = []
    day_index = {}
    d = _ts_local(hist_start).date()
    d_end = _ts_local(now).date()
    while d <= d_end:
        days.append((d, {"requests": 0, "input": 0, "output": 0}))
        d += datetime.timedelta(days=1)
    day_index = {day: i for i, (day, _) in enumerate(days)}
    for r in hist_rows:
        d = _ts_local(r["time_created"]).date()
        i = day_index.get(d)
        if i is not None:
            days[i][1]["requests"] += 1
            days[i][1]["input"] += int(r["tokens_input"] or 0)
            days[i][1]["output"] += int(r["tokens_output"] or 0)

    raw = os.environ.get("TOKENMETRICS_DAILY_BUDGET")
    if raw is not None:
        try:
            budget = int(raw)
            source = "configured"
        except ValueError:
            budget = DAILY_BUDGET_DEFAULT
            source = "default"
    else:
        budget = DAILY_BUDGET_DEFAULT
        source = "default"

    history = []
    for day, g in days:
        tokens = g["input"] + g["output"]
        history.append({
            "date": day.strftime("%Y-%m-%d"),
            "label": day.strftime("%b %d"),
            "requests": g["requests"],
            "input": g["input"],
            "output": g["output"],
            "tokens": tokens,
            "budget": budget,
            "over": tokens > budget,
            "remaining": budget - tokens,
        })

    elapsed_h = (now - today) / 3600_000
    projected = round(today_tokens / (elapsed_h / 24.0)) if elapsed_h > 0 else today_tokens

    return {
        "today": {"requests": today_req, "input": today_input, "output": today_output,
                  "cacheRead": today_cache, "tokens": today_tokens},
        "config": {"target": budget, "source": source,
                   "note": "configured via TOKENMETRICS_DAILY_BUDGET" if source == "configured"
                           else "default estimate - set TOKENMETRICS_DAILY_BUDGET to pin a value"},
        "projectedToday": projected,
        "remaining": max(0, budget - today_tokens),
        "pct": (today_tokens / budget * 100) if budget else 0,
        "history": history,
        "timezone": ANALYTICS_TZ,
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


