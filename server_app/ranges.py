"""Calendar / rolling range helpers and token bucketing.

All calendar boundaries are computed in the analytics timezone
(ANALYTICS_TZ) while the database timestamps stay absolute epoch-ms.
"""

import datetime
import time

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

from .config import ANALYTICS_TZ, QUOTA_ANCHOR_HOUR, QUOTA_WINDOW_HOURS, RANGES

def now_ms():
    return int(time.time() * 1000)


def tzinfo():
    """Configured analytics timezone (ZoneInfo) or None -> local time."""
    tz = tzinfo._cache.get(ANALYTICS_TZ)
    if tz is None:
        try:
            tz = ZoneInfo(ANALYTICS_TZ) if ZoneInfo is not None else None
        except Exception:
            tz = None
        tzinfo._cache[ANALYTICS_TZ] = tz
    return tz


tzinfo._cache = {}


def tz_offset_str():
    """Current UTC offset of the analytics tz, e.g. '+07:00'."""
    tz = tzinfo()
    if tz:
        d = datetime.datetime.now(tz)
    else:
        d = datetime.datetime.now().astimezone()
    off = d.utcoffset() or datetime.timedelta(0)
    secs = int(off.total_seconds())
    sign = "+" if secs >= 0 else "-"
    secs = abs(secs)
    return "%s%02d:%02d" % (sign, secs // 3600, (secs % 3600) // 60)


def day_start_ms(ts, tz=None):
    """Local calendar midnight (analytics tz) of the timestamp's day, epoch ms."""
    tz = tz if tz is not None else tzinfo()
    if tz is None:
        d = datetime.datetime.fromtimestamp(ts / 1000)
        return int(datetime.datetime(d.year, d.month, d.day).timestamp() * 1000)
    d = datetime.datetime.fromtimestamp(ts / 1000, tz=tz)
    return int(datetime.datetime(d.year, d.month, d.day, tzinfo=tz).timestamp() * 1000)


def quota_window_bounds(now=None, hours=None, anchor_hour=None):
    """Estimated provider quota window - NOT a calendar day.

    The free tier evaluates quota over a ~12-14h reset window that is not
    aligned to midnight. We model it as windows of `hours` (default 14h)
    drifting from a fixed local clock hour (default 04:00): each window is
    exactly `hours` long and the reset moment is deterministic, but it is
    always an *estimate* - the provider never publishes the true reset time.
    """
    if now is None:
        now = now_ms()
    hours = hours if hours is not None else QUOTA_WINDOW_HOURS
    anchor_hour = anchor_hour if anchor_hour is not None else QUOTA_ANCHOR_HOUR
    ms = max(1, int(hours * 3600_000))
    tz = tzinfo()
    if tz is None:
        d = datetime.datetime.fromtimestamp(now / 1000)
        anchor0 = int(datetime.datetime(d.year, d.month, d.day, anchor_hour).timestamp() * 1000)
    else:
        d = datetime.datetime.fromtimestamp(now / 1000, tz=tz)
        anchor0 = int(datetime.datetime(d.year, d.month, d.day, anchor_hour, tzinfo=tz).timestamp() * 1000)
    k = (now - anchor0) // ms          # floor division handles negative offsets
    start = anchor0 + k * ms
    end = start + ms
    return {
        "start": start,
        "end": end,
        "resetAt": end,
        "elapsedMs": max(0, now - start),
        "hours": hours,
        "estimated": True,
    }


def _ts_local(ts):
    tz = tzinfo()
    return datetime.datetime.fromtimestamp(ts / 1000, tz=tz) if tz else datetime.datetime.fromtimestamp(ts / 1000)


def parse_custom_day(s):
    """'YYYY-MM-DD' -> epoch ms at local midnight in the analytics tz, or None."""
    try:
        d = datetime.datetime.strptime(str(s), "%Y-%m-%d").date()
    except Exception:
        return None
    tz = tzinfo()
    if tz is None:
        return int(datetime.datetime(d.year, d.month, d.day).timestamp() * 1000)
    return int(datetime.datetime(d.year, d.month, d.day, tzinfo=tz).timestamp() * 1000)


def range_bounds(range_key, from_date=None, to_date=None):
    """(start_ms, end_ms) for a range; None pair when custom dates are invalid.

    calendar: start = local midnight of the day `days_back` ago, end = now.
    rolling:  start = now - ms, end = now.
    custom:   start = midnight of `from`, end = midnight after `to` capped at now.
    """
    now = now_ms()
    if range_key == "custom":
        f = parse_custom_day(from_date)
        t = parse_custom_day(to_date)
        if f is None or t is None or t < f:
            return None, None
        end = min(day_start_ms(t + 86_400_000), now)
        return f, max(end, f)
    cfg = RANGES[range_key]
    if cfg.get("kind") == "rolling":
        return now - cfg["ms"], now
    return day_start_ms(now - cfg["days_back"] * 86_400_000), now


def prev_bounds(range_key, start, end, from_date=None, to_date=None):
    """Window immediately before [start, end): calendar -> full prior days,
    rolling -> previous `ms`, custom -> same length before `start`."""
    if range_key == "custom":
        length = end - start
        return start - length, start
    cfg = RANGES[range_key]
    if cfg.get("kind") == "rolling":
        return start - cfg["ms"], start
    return start - (cfg["days_back"] + 1) * 86_400_000, start


def range_detail(range_key, start, end):
    """Human label for the active period, e.g. '00:00-09:07 (+07:00)'."""
    off = tz_offset_str()
    if range_key == "today":
        return "%s-%s (%s)" % (
            _ts_local(start).strftime("%H:%M"), _ts_local(end).strftime("%H:%M"), off)
    if range_key == "24h":
        return "%s \u2192 %s" % (
            _ts_local(start).strftime("%b %d %H:%M"), _ts_local(end).strftime("%b %d %H:%M"))
    return "%s-%s" % (
        _ts_local(start).strftime("%b %d"), _ts_local(end).strftime("%b %d %Y"))


def build_buckets(range_key, start, end, token_rows):
    """Bucket message token rows: hourly for today/24h, calendar days otherwise.

    `start`/`end` are the actual (calendar or rolling) window bounds, so bucket
    labels always match the period shown - never NOW - N*24h arithmetic.
    """
    if range_key in ("today", "24h"):
        span_h = (end - start) / 3600_000
        n = max(1, int(span_h) if span_h == int(span_h) else int(span_h) + 1)
        buckets = [
            {"label": _ts_local(start + i * 3600_000).strftime("%H:%M"),
             "requests": 0, "input": 0, "output": 0}
            for i in range(n)
        ]
        for r in token_rows:
            i = int((r["time_created"] - start) / 3600_000)
            if 0 <= i < n:
                buckets[i]["requests"] += 1
                buckets[i]["input"] += int(r["tokens_input"] or 0)
                buckets[i]["output"] += int(r["tokens_output"] or 0)
        return buckets

    days = []
    day_index = {}
    d = _ts_local(start).date()
    d_end = _ts_local(end).date()
    while d <= d_end:
        days.append((d, {"label": d.strftime("%b %d"), "requests": 0, "input": 0, "output": 0}))
        d += datetime.timedelta(days=1)
    day_index = {day: i for i, (day, _) in enumerate(days)}
    for r in token_rows:
        d = _ts_local(r["time_created"]).date()
        i = day_index.get(d)
        if i is not None:
            days[i][1]["requests"] += 1
            days[i][1]["input"] += int(r["tokens_input"] or 0)
            days[i][1]["output"] += int(r["tokens_output"] or 0)
    return [b for _, b in days]



