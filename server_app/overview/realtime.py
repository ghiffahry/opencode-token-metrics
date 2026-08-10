"""Realtime payload for /api/realtime."""

import datetime
import json

from ..db import context_for, load_context_map, msg_scope, q
from ..ranges import now_ms, quota_window_bounds
from .sessions import sessions


def realtime(project=None, model=None):
    now = now_ms()
    min1 = now - 60_000
    wb = quota_window_bounds(now)
    limits = load_context_map()
    m_sql, m_par = msg_scope(project, model)

    watermark_row = q("SELECT id FROM event ORDER BY id DESC LIMIT 1")
    watermark = watermark_row[0]["id"] if watermark_row else ""

    win_requests = q("SELECT 1 FROM message WHERE time_created >= ? "
                     "AND json_extract(data, '$.role') = 'assistant' "
                     "AND json_extract(data, '$.modelID') IS NOT NULL" + m_sql,
                     (wb["start"],) + m_par)
    win_tokens = q("SELECT json_extract(data, '$.tokens.input') AS tokens_input, "
                   "json_extract(data, '$.tokens.output') AS tokens_output, "
                   "json_extract(data, '$.tokens.cache.read') AS tokens_cache_read "
                   "FROM message WHERE time_created >= ? "
                   "AND json_extract(data, '$.role') = 'assistant'"
                   + m_sql, (wb["start"],) + m_par)
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
        "window": {
            "start": wb["start"],
            "end": wb["end"],
            "resetAt": wb["resetAt"],
            "requests": len(win_requests),
            "input": sum(int(r["tokens_input"] or 0) for r in win_tokens),
            "output": sum(int(r["tokens_output"] or 0) for r in win_tokens),
            "cacheRead": sum(int(r["tokens_cache_read"] or 0) for r in win_tokens),
            "tokens": sum(int(r["tokens_input"] or 0) + int(r["tokens_output"] or 0) for r in win_tokens),
        },
        "sessions": sess,
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
