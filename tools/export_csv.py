#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export opencode aggregates to CSV from the CLI (no browser needed).

Reads the database directly (same read-only queries as server_app), so the
bridge does not need to be running.

Usage:
  py tools/export_csv.py --range 7d
  py tools/export_csv.py --range 30d --project "C:/Users/you/projects/my-app"
  py tools/export_csv.py --out runtime/exports
"""

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server_app.config import RANGES  # noqa: E402
from server_app.overview import models, overview, requests_list  # noqa: E402


def write(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerows(rows)
    print("wrote %-28s (%d rows)" % (path.name, len(rows)))


def main():
    ap = argparse.ArgumentParser(description="Export opencode aggregates to CSV")
    ap.add_argument("--range", default="7d", choices=sorted(RANGES))
    ap.add_argument("--project", default=None, help="filter by session directory")
    ap.add_argument("--out", default="runtime/exports")
    args = ap.parse_args()

    out = Path(args.out)
    rng = args.range
    proj = args.project

    ov = overview(rng, proj)
    write(out / ("overview_%s.csv" % rng), [
        ["key", "value"],
        ["range", ov["range"]],
        ["project", ov.get("project") or ""],
        ["requests", ov["requests"]],
        ["success", ov["success"]],
        ["errors", ov["errors"]],
        ["success_rate", "%.2f" % ov["successRate"]],
        ["input", ov["input"]],
        ["output", ov["output"]],
        ["reasoning", ov["reasoning"]],
        ["cache_read", ov["cacheRead"]],
        ["total", ov["total"]],
        ["latency_ms", ov["latency"]],
        ["avg_in", ov["avgIn"]],
        ["avg_out", ov["avgOut"]],
        ["ratio", "%.4f" % ov["ratio"]],
        ["cost", "%.6f" % ov["cost"]],
    ])
    write(out / ("buckets_%s.csv" % rng), [["label", "requests", "input", "output"]] + [
        [b["label"], b["requests"], b["input"], b["output"]] for b in ov["buckets"]
    ])
    write(out / ("stages_%s.csv" % rng), [["name", "input", "output"]] + [
        [s["name"], s["input"], s["output"]] for s in ov["stages"]
    ])

    md = models(rng, proj)
    write(out / ("models_%s.csv" % rng), [
        ["id", "requests", "input", "output", "cache_read", "reasoning",
         "errors", "success", "success_rate", "latency_ms", "status",
         "context_limit", "context_used", "sessions"],
    ] + [
        [m["id"], m["requests"], m["input"], m["output"], m["cacheRead"],
         m["reasoning"], m["errors"], m["success"], "%.2f" % m["successRate"],
         m["latency"], m["status"], m["contextLimit"], m["contextUsed"],
         m["sessions"]]
        for m in md["models"]
    ])

    rr = requests_list(200, proj)
    write(out / ("requests_%s.csv" % rng), [
        ["id", "model", "agent", "input", "output", "total", "latency_ms",
         "status", "time"],
    ] + [
        [r["id"], r["model"], r["agent"], r["input"], r["output"], r["total"],
         r["latency"], r["status"], r["time"]]
        for r in rr["requests"]
    ])

    print("\nProject filter: %s" % (proj or "(none)"))
    print("Done. Output directory: %s" % out.resolve())


if __name__ == "__main__":
    main()
