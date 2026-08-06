#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print the schema of the opencode database (read-only).

Usage:
  py tools/schema_report.py
  py tools/schema_report.py session message
"""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402


def main():
    only = set(sys.argv[1:])
    db = common.DB_PATH
    if not db.exists():
        print("DB not found: %s" % db)
        sys.exit(1)

    con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    try:
        con.execute("PRAGMA query_only=ON")
        c = con.cursor()
        tables = [r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        if only:
            tables = [t for t in tables if t in only]

        for t in tables:
            print("== %s ==" % t)
            for col in c.execute("PRAGMA table_info(%s)" % t):
                pk = " PK" if col[5] else ""
                print("   %-28s %-12s%s" % (col[1], col[2], pk))
            print()
    finally:
        con.close()


if __name__ == "__main__":
    main()
