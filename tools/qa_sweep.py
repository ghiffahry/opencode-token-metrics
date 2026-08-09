"""QA sweep: hit every /api endpoint with valid & invalid params, validate
status codes and numeric response shape against the real payload contract.

Usage: py tools/qa_sweep.py [base_url]
"""

import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8124"

FAILURES = []
CHECKS = 0


def check(ok, label, detail=""):
    global CHECKS
    CHECKS += 1
    if not ok:
        FAILURES.append("%s %s" % (label, detail))
        print("FAIL %s %s" % (label, detail))


def get(path, params=None, expect=200):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode("utf-8", "replace")
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode("utf-8", "replace")
    except Exception as e:
        return None, 0, str(e)
    if status != expect:
        return None, status, "status %d want %d" % (status, expect)
    try:
        return json.loads(body), status, ""
    except ValueError:
        return None, status, "invalid JSON"


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def require(obj, keys, label=""):
    if not isinstance(obj, dict):
        check(False, label + " shape", "not an object")
        return
    for k in keys:
        check(k in obj, label + "." + k, "missing")


def nums(d, keys, label):
    for k in keys:
        check(is_number(d.get(k)), "%s.%s" % (label, k), "not numeric")


# ---------------------------------------------------------------- health
d, s, err = get("/api/health")
check(d is not None, "health", err or "")
check(d.get("ok") is True, "health.ok", str(d)[:120])
check(is_number(d.get("dbSize")), "health.dbSize", str(type(d.get("dbSize"))))

# ---------------------------------------------------------------- meta
d, s, err = get("/api/meta")
check(d is not None, "meta", err or "")
if d:
    require(d, ["source", "version", "ranges", "rateLimits", "activeWindowMs", "timezone", "timezoneOffset"], "meta")

# ---------------------------------------------------------------- projects
d, s, err = get("/api/projects")
check(d is not None, "projects", err or "")
if isinstance(d, dict):
    for i, p in enumerate((d.get("projects") or [])[:3]):
        require(p, ["id", "directory", "name", "sessions"], "projects[%d]" % i)

# ---------------------------------------------------------------- context map
d, s, err = get("/api/context")
check(d is not None, "context", err or "")
if d:
    require(d, ["models", "default"], "context")
    check(is_number(d.get("default")), "context.default")

# ---------------------------------------------------------------- graph
d, s, err = get("/api/graph")
if d is None:
    print("WARN graph unreachable (graphify-out may not exist)")
else:
    check("ok" in d, "graph.ok")
    if d.get("ok"):
        check(isinstance(d.get("nodes"), list), "graph.nodes")
        check(isinstance(d.get("links"), list), "graph.links")

# ---------------------------------------------------------------- overview (all ranges)
for rng in ["today", "7d", "30d", "90d", "24h", "bogus"]:
    d, s, err = get("/api/overview", {"range": rng})
    if d is None:
        check(False, "overview %s" % rng, str(err or s))
        continue
    nums(d, ["requests", "input", "output", "total", "successRate", "latency"], "overview %s" % rng)
    b = d.get("buckets") or []
    check(isinstance(b, list) and len(b) > 0, "overview %s.buckets" % rng, "empty")
    for bi, bucket in enumerate(b[:4]):
        require(bucket, ["label", "requests", "input", "output"], "overview %s.bucket[%d]" % (rng, bi))
        nums(bucket, ["requests", "input", "output"], "overview %s.bucket[%d]" % (rng, bi))

# custom range (future dates clamped to today)
d, s, err = get("/api/overview", {"range": "custom", "from": "2026-07-01", "to": "2026-07-07"})
check(d is not None, "overview custom", str(err or s) + str("" if s else ""))
d, s, err = get("/api/overview", {"range": "custom", "from": "garbage", "to": "also"})
check(d is not None, "overview custom bad dates", str(err or s))
d, s, err = get("/api/overview", {"range": "custom", "from": "2026-08-09", "to": "2026-08-01"})
check(d is not None, "overview custom inverted", str(err or s))

# ---------------------------------------------------------------- models
for rng in ["today", "30d"]:
    d, s, err = get("/api/models", {"range": rng})
    check(d is not None, "models %s" % rng, str(err or s))
    if d:
        require(d, ["models", "defaultContext"], "models %s" % rng)
        check(isinstance(d.get("models"), list), "models %s.models" % rng)

# ---------------------------------------------------------------- context_usage
d, s, err = get("/api/context_usage", {"range": "7d"})
check(d is not None, "context_usage", str(err or s))
if d:
    for k in ["latest", "peak", "byModel", "bySession", "byAgent", "byDay", "composition", "counts"]:
        check(k in d, "context_usage.%s" % k)

# ---------------------------------------------------------------- budget
d, s, err = get("/api/budget")
check(d is not None, "budget", str(err or s))
if d:
    win = d.get("window") or {}
    for k in ["limit", "hours", "anchorHour", "start", "end", "resetAt", "used",
              "remaining", "pct", "requests", "burnRate", "projectedAtReset",
              "willExhaustBeforeReset", "status", "series"]:
        check(k in win, "budget.window.%s" % k)
    check(isinstance(win.get("series"), list) and len(win.get("series") or []) > 0, "budget.window.series")
    for b in (win.get("series") or [])[:3]:
        require(b, ["label", "requests", "tokens"], "budget.series")
    check("today" in d, "budget.today")
    check("history" in d, "budget.history")
    h = d.get("history") or []
    check(isinstance(h, list), "budget.history list")

# ---------------------------------------------------------------- sessions / requests
for limit in ["5", "200", "abc", "0"]:
    d, s, err = get("/api/sessions", {"limit": limit})
    check(d is not None, "sessions limit=%s" % limit, str(err or s))
    if d:
        rows = (d.get("sessions") or [])
        check(isinstance(rows, list) and len(rows) <= 100, "sessions limit=%s cap" % limit)

for limit in ["5", "500", "xx"]:
    d, s, err = get("/api/requests", {"limit": limit})
    check(d is not None, "requests limit=%s" % limit, str(err or s))
    if d:
        rows = (d.get("requests") or [])
        check(isinstance(rows, list) and len(rows) <= 200, "requests limit=%s cap" % limit)

# ---------------------------------------------------------------- realtime
d, s, err = get("/api/realtime")
check(d is not None, "realtime", str(err or s))
if d:
    for k in ["watermark", "activeSessions", "requestsLastMinute", "tokensLastMinute", "window", "sessions"]:
        check(k in d, "realtime.%s" % k)
    check(isinstance(d.get("sessions"), list), "realtime.sessions")
    nums(d, ["requestsLastMinute"], "realtime")

# ---------------------------------------------------------------- plugin_state
d, s, err = get("/api/plugin_state")
check(d is not None, "plugin_state", str(err or s))
if d:
    check("exists" in d, "plugin_state.exists")
    check("path" in d, "plugin_state.path")
    if d.get("exists"):
        nums(d.get("window") or {}, ["tokens", "pct"], "plugin_state.window")

# ---------------------------------------------------------------- project filter
projs = []
d, s, err = get("/api/projects")
if d and isinstance(d.get("projects"), list) and d["projects"]:
    projs = d["projects"][:3]
for p in projs:
    pid = p["id"]
    for ep in ["/api/overview", "/api/models", "/api/sessions", "/api/realtime"]:
        d, s, err = get(ep, {"project": pid, "range": "7d"})
        check(d is not None, "project filter %s" % ep, str(err or s))
d, s, err = get("/api/overview", {"project": "C:/nope/missing-dir", "range": "7d"})
check(d is not None, "project filter missing dir", str(err or s))

# ---------------------------------------------------------------- misc robustness
d, s, err = get("/api/sessions", {"limit": "-5"})
check(d is not None, "sessions negative limit", str(err or s))
d, s, err = get("/api/requests", {"project": "x\u0000y"})
check(d is not None, "requests null byte in project", str(err or s))
d, s, err = get("/api/overview", {"range": "90d", "model": "some/unknown-model-xyz"})
check(d is not None, "overview unknown model", str(err or s))

# ---------------------------------------------------------------- unknown endpoint
d, s, err = get("/api/nope")
check(s == 404, "unknown endpoint status", str(s))

# ---------------------------------------------------------------- static assets
for path in ["/", "/index.html", "/static/js/main.js", "/static/css/base.css", "/static/favicon.svg"]:
    try:
        with urllib.request.urlopen(BASE + path, timeout=10) as r:
            check(r.status == 200, "static %s" % path, str(r.status))
    except Exception as e:
        check(False, "static %s" % path, str(e))

print("checks=%d failures=%d" % (CHECKS, len(FAILURES)))
for f in FAILURES:
    print("  %s" % f)
sys.exit(1 if FAILURES else 0)