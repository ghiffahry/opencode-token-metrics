#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print the model -> context-window map (models.json + overrides + default).

Usage:
  py tools/context_map.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


def main():
    limits = server.load_context_map()
    print("Default context : %d" % server.DEFAULT_CONTEXT)
    print("Context map     : %s" % ("(cached models.json)" if server.MODELS_CACHE.exists()
                                    else "(models.json missing)"))
    print()
    if not limits:
        print("(empty)")
        return
    width = max(len(k) for k in limits)
    for k in sorted(limits, key=lambda x: limits[x], reverse=True):
        tag = ""
        if k in server.MODEL_CONTEXT_OVERRIDES:
            tag = "  <-- override"
        print("%-*s  %8d%s" % (width, k, limits[k], tag))
    print()
    print("Override keys:")
    for k, v in server.MODEL_CONTEXT_OVERRIDES.items():
        print("  %-50s %d" % (k, v))


if __name__ == "__main__":
    main()
