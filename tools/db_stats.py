import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  

def main():
    db = common.DB_PATH
    if not db.exists():
        print("DB not found: %s" % db)
        sys.exit(1)

    con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    try:
        con.execute("PRAGMA query_only=ON")
        c = con.cursor()

        print("DB      : %s" % db)
        print("Size    : %.1f MiB" % (db.stat().st_size / 1024 / 1024))
        wal = Path(str(db) + "-wal")
        if wal.exists():
            print("WAL     : %.1f MiB" % (wal.stat().st_size / 1024 / 1024))
        try:
            mode = c.execute("PRAGMA journal_mode").fetchone()[0]
            print("Journal : %s" % mode)
        except Exception:
            pass
        print()

        for t in ("session", "message", "part", "event", "project", "project_directory"):
            try:
                n = c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
                print("%-18s %d" % (t, n))
            except Exception as e:
                print("%-18s ERR %s" % (t, e))

        wm = c.execute("SELECT id FROM event ORDER BY id DESC LIMIT 1").fetchone()
        print("\nWatermark: %s" % (wm[0] if wm else "(none)"))

        print("\nSessions by directory:")
        for r in c.execute(
            "SELECT COALESCE(NULLIF(directory,''),'(unknown)'), COUNT(*) "
            "FROM session GROUP BY directory ORDER BY 2 DESC"
        ):
            print("  %-50s %d" % (r[0], r[1]))

        print("\nRequests (assistant msgs with modelID):")
        for r in c.execute(
            "SELECT json_extract(data,'$.modelID'), COUNT(*) FROM message "
            "WHERE json_extract(data,'$.role')='assistant' "
            "GROUP BY json_extract(data,'$.modelID') ORDER BY 2 DESC"
        ):
            print("  %-40s %d" % (r[0], r[1]))
    finally:
        con.close()


if __name__ == "__main__":
    main()
