import datetime
import pytest

from server_app import ranges
from server_app.ranges import (
    day_start_ms,
    parse_custom_day,
    prev_bounds,
    quota_window_bounds,
    range_bounds,
    range_detail,
    tz_offset_str,
    tzinfo,
)

@pytest.fixture(autouse=True)
def utc_tz(monkeypatch):
    monkeypatch.setattr(ranges, "ANALYTICS_TZ", "UTC")
    ranges.tzinfo._cache.clear()
    yield
    ranges.tzinfo._cache.clear()

def test_quota_window_invariants():
    now = datetime.datetime(2026, 8, 9, 10, 30, tzinfo=datetime.timezone.utc)
    w = quota_window_bounds(now=now.timestamp() * 1000, hours=14, anchor_hour=4)
    assert w["end"] - w["start"] == 14 * 3600_000
    assert w["start"] <= now.timestamp() * 1000 < w["end"]
    assert w["estimated"] is True
    assert w["hours"] == 14

def test_quota_window_reset_deterministic():
    now1 = datetime.datetime(2026, 8, 9, 4, 0, 1, tzinfo=datetime.timezone.utc)
    now2 = datetime.datetime(2026, 8, 9, 4, 30, 0, tzinfo=datetime.timezone.utc)
    w1 = quota_window_bounds(now=now1.timestamp() * 1000, hours=14, anchor_hour=4)
    w2 = quota_window_bounds(now=now2.timestamp() * 1000, hours=14, anchor_hour=4)
    assert w1["start"] == w2["start"]
    assert w1["end"] == w2["end"]


def test_quota_window_custom_knobs():
    now = datetime.datetime(2026, 8, 9, 10, 30, tzinfo=datetime.timezone.utc)
    w = quota_window_bounds(now=now.timestamp() * 1000, hours=4, anchor_hour=0)
    assert w["hours"] == 4
    assert w["end"] - w["start"] == 4 * 3600_000


def test_day_start_ms():
    ts = datetime.datetime(2026, 8, 9, 15, 45, tzinfo=datetime.timezone.utc)
    start = day_start_ms(ts.timestamp() * 1000)
    expect = datetime.datetime(2026, 8, 9, 0, 0, tzinfo=datetime.timezone.utc)
    assert start == expect.timestamp() * 1000


def test_parse_custom_day():
    good = parse_custom_day("2026-08-09")
    assert good is not None
    assert good == day_start_ms(
        datetime.datetime(2026, 8, 9, 12, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    assert parse_custom_day("not-a-date") is None
    assert parse_custom_day("") is None


def test_range_bounds_calendar():
    start, end = range_bounds("today")
    assert start < end
    assert start == day_start_ms(end - 1)


def test_range_bounds_rolling():
    start, end = range_bounds("24h")
    assert end - start == 86_400_000


def test_range_bounds_custom():
    f = parse_custom_day("2026-08-01")
    t = parse_custom_day("2026-08-03")
    start, end = range_bounds("custom", from_date="2026-08-01", to_date="2026-08-03")
    assert start == f
    assert end - start == 3 * 86_400_000  # inclusive: Aug 1-3, end = Aug 4 midnight
    assert range_bounds("custom", from_date="2026-08-03", to_date="2026-08-01") == (None, None)


def test_range_detail_custom_inclusive_end():
    """Custom label shows the last *selected* day, not the exclusive midnight."""
    f = parse_custom_day("2026-08-01")
    t = parse_custom_day("2026-08-03")
    start, end = range_bounds("custom", from_date="2026-08-01", to_date="2026-08-03")
    label = range_detail("custom", start, end)
    assert label == "Aug 01-Aug 03 2026"
    assert "\u2013" not in label
    assert "\u2014" not in label


def test_build_buckets_custom_no_trailing_empty_day():
    start = parse_custom_day("2026-08-01")
    end = start + 3 * 86_400_000  # midnight after Aug 3 (exclusive)
    rows = [{"time_created": start + 86_400_000 + 3600_000, "tokens_input": 500, "tokens_output": 0}]
    days = ranges.build_buckets("custom", start, end, rows)
    assert len(days) == 3  # Aug 1, Aug 2, Aug 3 - no empty Aug 4
    assert days[1]["requests"] == 1
    assert days[1]["input"] == 500
    assert days[2]["requests"] == 0


def test_prev_bounds():
    start, end = range_bounds("7d")
    ps, pe = prev_bounds("7d", start, end)
    assert pe == start
    assert pe - ps == 7 * 86_400_000  # calendar prev = full prior days
    r_start, r_end = range_bounds("24h")
    rps, rpe = prev_bounds("24h", r_start, r_end)
    assert rpe - rps == 86_400_000


def test_range_detail_no_dash_glyphs():
    """Range labels must not contain em/en dash characters (U+2013/U+2014)."""
    now = datetime.datetime(2026, 8, 9, 10, 30, tzinfo=datetime.timezone.utc)
    ts = now.timestamp() * 1000
    for key in ("today", "24h", "7d"):
        label = range_detail(key, ts - 3600_000, ts)
        assert "\u2013" not in label
        assert "\u2014" not in label


def test_tz_offset_str():
    assert tzinfo() is not None
    assert tz_offset_str() in ("+00:00", "-00:00")


def test_build_buckets_hourly():
    base = day_start_ms(datetime.datetime(2026, 8, 9, 0, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    rows = [
        {"time_created": base, "tokens_input": 100, "tokens_output": 50},
        {"time_created": base + 3600_000, "tokens_input": 10, "tokens_output": 20},
    ]
    buckets = ranges.build_buckets("today", base, base + 3 * 3600_000, rows)
    assert len(buckets) == 3
    assert buckets[0]["requests"] == 1
    assert buckets[0]["input"] == 100
    assert buckets[0]["output"] == 50
    assert buckets[1]["input"] == 10
    assert buckets[2]["requests"] == 0


def test_build_buckets_calendar():
    start = day_start_ms(datetime.datetime(2026, 8, 1, 0, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    end = start + 3 * 86_400_000
    rows = [{"time_created": start + 86_400_000, "tokens_input": 500, "tokens_output": 0}]
    days = ranges.build_buckets("7d", start, end, rows)
    assert len(days) == 4
    assert days[1]["requests"] == 1
    assert days[1]["input"] == 500
