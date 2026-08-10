from pathlib import Path
from .config import CONTEXT_ESTIMATE_DEFAULTS

def _read_text(p):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

def estimate_composition(directory, input_total, req=None):
    directory = directory or ""
    d = Path(directory) if Path(directory).is_dir() else None

    def size(txt):
        return max(1, int(len(txt) / 4))

    rules_text = skills_text = mcp_text = ""
    if d:
        for name in ("AGENTS.md", "CLAUDE.md"):
            p = d / name
            if p.is_file():
                rules_text += _read_text(p)
        try:
            for p in sorted(d.glob(".rules*")):
                rules_text += _read_text(p)
        except Exception:
            pass
        try:
            for p in sorted((d / ".agents").glob("skills/*/SKILL.md")):
                skills_text += _read_text(p)
        except Exception:
            pass
        p = d / "skills-lock.json"
        if p.is_file():
            skills_text += _read_text(p)
        p = d / "opencode.json"
        if p.is_file():
            mcp_text += _read_text(p)
        p = d / ".opencode" / "opencode.json"
        if p.is_file():
            mcp_text += _read_text(p)

    static = {
        "system_prompt": CONTEXT_ESTIMATE_DEFAULTS["system_prompt"],
        "tool_definitions": CONTEXT_ESTIMATE_DEFAULTS["tool_definitions"],
        "rules": size(rules_text),
        "skills": size(skills_text),
        "mcp": size(mcp_text),
    }
    if input_total <= 0:
        return {"segments": [], "estimated": True,
                "note": "Tidak ada token input nyata untuk request ini - komposisi kosong."}
    cached = int(req["cached"] or 0) if req else 0
    uncached = max(0, input_total - cached)
    static_total = sum(static.values())
    if cached > 0 and static_total > cached:
        scale = cached / static_total
        static = {k: max(1, int(v * scale)) for k, v in static.items()}
        static_total = sum(static.values())
    assigned = min(static_total, cached)
    conv_old = max(0, cached - assigned)
    conv_new = int(uncached * 0.35)
    workspace = int(uncached * 0.40)
    retrieved = int(uncached * 0.25)
    cats = dict(static)
    cats["conversation"] = conv_old + conv_new
    cats["workspace_context"] = workspace
    cats["retrieved_context"] = retrieved

    total = sum(cats.values())
    if total != input_total and total > 0:
        diff = input_total - total
        for key in sorted(cats, key=cats.get, reverse=True):
            if diff == 0:
                break
            value = cats[key]
            if diff > 0:
                cats[key] = value + diff
                diff = 0
            else:
                take = min(value, -diff)
                cats[key] = value - take
                diff += take

    out = [{"category": k, "tokens": v,
            "pct": round(v / input_total * 100, 1) if input_total else 0,
            "estimated": True} for k, v in cats.items()]
    out.sort(key=lambda c: c["tokens"], reverse=True)
    return {
        "segments": out,
        "estimated": True,
        "note": ("Heuristic estimate - opencode.db does not record token attribution per category. "
                 "Total %d real input tokens split: static categories estimated from project files "
                 "(AGENTS.md/.rules/SKILL.md/opencode.json), the remainder as conversation/"
                 "workspace/retrieved." % input_total),
    }
