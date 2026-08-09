"""Cross-endpoint consistency QA: totals must agree between endpoints that
derive from the same source data (overview vs models vs buckets vs budget).

Usage: py tools/qa_consistency.py [base_url]
"""

import json
import sys
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


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=15) as r:
            return json.loads(r.read().decode("utf-8", "replace")), ""
    except Exception as e:
        return None, str(e)


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


for rng in ["today", "7d", "30d", "90d"]:
    ov, err = get("/api/overview?range=" + rng)
    mo, _ = get("/api/models?range=" + rng)
    if ov is None or mo is None:
        check(False, "%s reachability" % rng, err)
        continue
    o = ov
    rows = mo.get("models") or []
    in_m = sum(r.get("input", 0) for r in rows)
    out_m = sum(r.get("output", 0) for r in rows)
    req_m = sum(r.get("requests", 0) for r in rows)
    check(in_m == o.get("input", 0), "%s input models==overview" % rng,
          "%d != %d" % (in_m, o.get("input", 0)))
    check(out_m == o.get("output", 0), "%s output models==overview" % rng,
          "%d != %d" % (out_m, o.get("output", 0)))
    check(req_m == o.get("requests", 0), "%s requests models==overview" % rng,
          "%d != %d" % (req_m, o.get("requests", 0)))

    # buckets sum == overview totals (input/output; requests can include
    # bucket overflow only when rows fall outside bounds - skip requests)
    b_in = sum(b.get("input", 0) for b in (o.get("buckets") or []))
    b_out = sum(b.get("output", 0) for b in (o.get("buckets") or []))
    check(b_in == o.get("input", 0), "%s buckets input==overview" % rng,
          "%d != %d" % (b_in, o.get("input", 0)))
    check(b_out == o.get("output", 0), "%s buckets output==overview" % rng,
          "%d != %d" % (b_out, o.get("output", 0)))

    # kpi-style checks: total = input + output + cached + reasoning (when present)
    total = o.get("total")
    parts = (o.get("input") or 0) + (o.get("output") or 0)
    check(total is None or not is_number(total) or total >= parts - 1,
          "%s total>=input+output" % rng, "%s vs %d" % (total, parts))

    rl = o.get("rateLimits") or {}
    for k in ["rpm", "tpm", "rpd", "dtp"]:
        item = rl.get(k) or {}
        if item:
            check(is_number(item.get("limit")), "%s rateLimit.%s.limit" % (rng, k))

# budget: window.tokens vs its own series; pct = used/limit (within tolerance)
b, err = get("/api/budget")
if b:
    win = b.get("window") or {}
    used = win.get("used")
    limit = win.get("limit")
    pct = win.get("pct")
    if is_number(used) and is_number(limit) and limit:
        expect = (used / limit) * 100
        if is_number(pct):
            check(abs(pct - expect) < 0.05, "budget pct==used/limit",
                  "%s vs %s" % (pct, round(expect, 3)))
    ser_tokens = sum((x.get("tokens") or 0) for x in (win.get("series") or []))
    if is_number(used):
        # hour bucket does not need to equal used exactly (window anchor
        # rounding), so only flag on big drift
        check(abs(ser_tokens - used) <= 1, "budget series==used", "%d vs %d" % (ser_tokens, used))
    status = win.get("status")
    check(status in ("healthy", "watch", "high", "critical", "exhaustion", "empty"),
          "budget status value", str(status))
else:
    check(False, "budget reachability", err)

# realtime window tokens == budget window used (same derivation)
rt, _ = get("/api/realtime")
rt_win = (rt or {}).get("window") or {}
rt_tok = (rt_win.get("input") or 0) + (rt_win.get("output") or 0)
check(not is_number(rt_tok) or not is_number(used) or abs(rt_tok - used) < 2,
      "realtime window==budget used", "%d vs %s" % (rt_tok, used))

# context_usage latest request should appear in recent sessions too
cu, _ = get("/api/context_usage?range=7d")
if cu:
    check("latest" in cu, "context_usage.latest")
    latest = cu.get("latest") or {}
    check("id" in latest, "context_usage.latest.id")

print("checks=%d failures=%d" % (CHECKS, len(FAILURES)))
for f in FAILURES:
    print("  %s" % f)
sys.exit(1 if FAILURES else 0)