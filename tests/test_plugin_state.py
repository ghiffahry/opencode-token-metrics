"""Unit tests for server_app.plugin_state (live .json from the opencode plugin)."""

import importlib
import json

ps_mod = importlib.import_module("server_app.plugin_state")


def test_missing_state_file(tmp_path, monkeypatch):
    missing = tmp_path / "missing" / "state.json"
    monkeypatch.setenv("TOKENMETRICS_STATE", str(missing))
    out = ps_mod.plugin_state()
    assert out["ok"] is True
    assert out["exists"] is False
    assert out["path"] == str(missing)


def test_valid_state_file(tmp_path, monkeypatch):
    state_file = tmp_path / "state.json"
    state_file.write_text(json.dumps({
        "version": 1,
        "generated": "2026-08-09T10:00:00.000Z",
        "config": {"limit": 2500000, "hours": 14, "anchorHour": 4, "source": "default"},
        "sessions": {
            "s_a": {"messages": 12, "messageIDs": ["m1", "m2"]},
            "s_b": {"messages": 0, "messageIDs": []},
        },
        "window": {"start": 1, "end": 2, "limit": 2500000, "tokens": 10500,
                   "requests": 3, "remaining": 2489500, "pct": 0.42, "status": "healthy"},
    }), encoding="utf-8")
    monkeypatch.setenv("TOKENMETRICS_STATE", str(state_file))
    out = ps_mod.plugin_state()
    assert out["ok"] is True
    assert out["exists"] is True
    assert out["sessions"] == 1
    assert out["messages"] == 2
    assert out["window"]["tokens"] == 10500
    assert out["window"]["status"] == "healthy"


def test_corrupt_state_file(tmp_path, monkeypatch):
    state_file = tmp_path / "state.json"
    state_file.write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("TOKENMETRICS_STATE", str(state_file))
    out = ps_mod.plugin_state()
    assert out["ok"] is False
    assert out["exists"] is False
    assert "error" in out


def test_default_path_is_home(monkeypatch):
    monkeypatch.delenv("TOKENMETRICS_STATE", raising=False)
    p = ps_mod.state_path()
    parts = p.parts
    assert parts[-1] == "state.json"
    assert parts[-2] == "token-metrics"