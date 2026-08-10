"""Session list for /api/sessions."""

from ..config import ACTIVE_WINDOW_MS
from ..db import (message_model, msg_duration_seconds, msg_scope, parse_model,
                  q, session_scope)
from ..ranges import now_ms


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
