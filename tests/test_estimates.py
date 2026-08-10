from server_app.estimates import estimate_composition

def test_no_directory_empty_input():
    out = estimate_composition(None, 0)
    assert out["estimated"] is True
    assert out["segments"] == []

def test_normalization_without_files():
    out = estimate_composition("", 1000)
    total = sum(s["tokens"] for s in out["segments"])
    assert total == 1000
    assert all(s["estimated"] for s in out["segments"])

def test_cached_prefix_split(tmp_path):
    (tmp_path / "AGENTS.md").write_text("a" * 2000, encoding="utf-8")
    out = estimate_composition(str(tmp_path), 8000, req={"cached": 2000})
    total = sum(s["tokens"] for s in out["segments"])
    assert total == 8000
    cats = {s["category"]: s["tokens"] for s in out["segments"]}
    assert cats.get("workspace_context", 0) > 0
    assert cats.get("conversation", 0) > 0

def test_files_are_read(tmp_path):
    (tmp_path / "AGENTS.md").write_text("x" * 400, encoding="utf-8")
    out = estimate_composition(str(tmp_path), 100000, req={"cached": 0})
    cats = {s["category"]: s["tokens"] for s in out["segments"]}
    assert cats["rules"] >= 1

def test_missing_directory_is_clean():
    out = estimate_composition("C:/definitely/not/a/real/dir/xyz", 500, req={"cached": 0})
    assert sum(s["tokens"] for s in out["segments"]) == 500
