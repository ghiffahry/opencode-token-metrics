"""Recent request list for /api/requests."""

import json

from ..db import _msg_model_cond, message_model, q


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
            "sessionId": r["session_id"],
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
