"""HTTP-facing API handlers (no static serving)."""

import datetime
import json
import os
import time

from .cache import _cache, cache_get_or
from .config import (ACTIVE_WINDOW_MS, ANALYTICS_TZ, BASE_DIR,
                     DEFAULT_CONTEXT, GRAPH_JSON, GRAPH_VIEWS, MODELS_CACHE,
                     RANGES, RATE_LIMITS, RATE_LIMIT_SOURCES, VERSION, db_path)
from .context import context_usage, daily_budget
from .db import load_context_map, q
from .overview import (_empty_payload, models, overview, realtime, requests_list,
                       sessions)
from .ranges import tz_offset_str

def api_context():
    limits = load_context_map()
    return {"models": limits, "default": DEFAULT_CONTEXT}


def api_meta():
    return {
        "source": "opencode",
        "version": VERSION,
        "db": str(db_path()),
        "modelsCache": str(MODELS_CACHE) if MODELS_CACHE.exists() else None,
        "ranges": {k: {"label": v["label"]} for k, v in RANGES.items()},
        "rateLimits": RATE_LIMITS,
        "rateLimitSources": RATE_LIMIT_SOURCES,
        "activeWindowMs": ACTIVE_WINDOW_MS,
        "timezone": ANALYTICS_TZ,
        "timezoneOffset": tz_offset_str(),
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def api_health():
    db_exists = db_path().is_file()
    db_readable = db_exists and os.access(str(db_path()), os.R_OK)
    return {
        "ok": db_readable,
        "db": str(db_path()),
        "dbExists": db_exists,
        "dbReadable": db_readable,
        "dataSource": "opencode.sqlite" if db_readable else "unavailable",
        "dbSize": db_path().stat().st_size if db_exists else 0,
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


def handle_api(path, query):
    project = (query.get("project") or [None])[0]
    project = project if project else None
    model = (query.get("model") or [None])[0]
    model = model if model else None

    if not db_path().exists():
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

    def range_params():
        rng = query.get("range", ["today"])[0]
        if rng not in RANGES and rng != "custom":
            rng = "today"
        from_date = (query.get("from") or [None])[0]
        to_date = (query.get("to") or [None])[0]
        return rng, from_date, to_date

    if path == "/api/overview":
        rng, from_date, to_date = range_params()
        ttl = 5 if not model else 15
        key = "overview:%s:%s:%s:%s:%s" % (rng, project, model, from_date, to_date)
        return cache_get_or(key, ttl,
                            lambda: overview(rng, project, model, from_date, to_date))

    if path == "/api/models":
        rng, from_date, to_date = range_params()
        key = "models:%s:%s:%s:%s:%s" % (rng, project, model, from_date, to_date)
        return cache_get_or(key, 5,
                            lambda: models(rng, project, model, from_date, to_date))

    if path == "/api/context_usage":
        rng, from_date, to_date = range_params()
        key = "context_usage:%s:%s:%s:%s:%s" % (rng, project, model, from_date, to_date)
        return cache_get_or(key, 4,
                            lambda: context_usage(rng, project, model, from_date, to_date))

    if path == "/api/budget":
        return cache_get_or("budget:%s:%s" % (project, model), 3,
                            lambda: daily_budget(project, model))

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


