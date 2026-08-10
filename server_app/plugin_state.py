import json
import os
import time
from pathlib import Path

from .cache import _cache

DEFAULT_STATE_PATH = Path.home() / ".local" / "share" / "token-metrics" / "state.json"


def state_path():
    raw = os.environ.get("TOKENMETRICS_STATE")
    return Path(raw).expanduser() if raw else DEFAULT_STATE_PATH


def plugin_state():
    path = state_path()
    if not path.is_file():
        return {"ok": True, "exists": False, "path": str(path)}
    mtime = path.stat().st_mtime
    key = "plugin_state:%s:%s" % (path, mtime)
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        payload = cached[1]
    else:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            return {"ok": False, "exists": False, "path": str(path), "error": str(e)}
        window = data.get("window") or {}
        sessions = data.get("sessions") or {}
        payload = {
            "path": str(path),
            "mtime": mtime,
            "version": data.get("version"),
            "generated": data.get("generated"),
            "config": data.get("config"),
            "sessions": sum(1 for s in sessions.values() if s.get("messages", 0) > 0),
            "messages": sum(len(s.get("messageIDs") or []) for s in sessions.values()),
            "window": {
                "start": window.get("start"),
                "end": window.get("end"),
                "limit": window.get("limit"),
                "tokens": window.get("tokens"),
                "requests": window.get("requests"),
                "remaining": window.get("remaining"),
                "pct": window.get("pct"),
                "status": window.get("status"),
            },
        }
        _cache[key] = (time.time() + 5, payload)
    return {"ok": True, "exists": True, **payload}
