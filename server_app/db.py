import json
import sqlite3
from .cache import _cache
from .config import DEFAULT_CONTEXT, MODELS_CACHE, MODEL_CONTEXT_OVERRIDES, db_path

def connect():
    con = sqlite3.connect("file:%s?mode=ro" % db_path(), uri=True)
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
    global _modelid_map_key, _modelid_map_value
    try:
        key = (db_path().stat().st_mtime,
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
