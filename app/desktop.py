#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Token Metrics desktop app (pywebview + embedded loopback server).

Runs the server.py bridge inside this process on a private 127.0.0.1 port
and opens a native window (Microsoft Edge WebView2 via pywebview).
No browser tab, no exposed server: only a loopback port that the desktop
window talks to.

Usage:
  py desktop.py            # console version
  double-click desktop.pyw # no console window
  TokenMetrics.bat         # launcher
"""

import json
import sys
import threading
from pathlib import Path

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent
    sys.path.insert(0, str(ROOT.parent))

import server

APP_NAME = "Token Metrics"
CONFIG_PATH = ROOT / "config.json"

DEFAULTS = {
    "dbPath": "",        # "" -> server default (~/.local/share/opencode/opencode.db)
    "host": "127.0.0.1",
    "port": 0,           # 0 -> OS picks a free loopback port
    "width": 1440,
    "height": 900,
    "minWidth": 980,
    "minHeight": 640,
}


def load_config():
    cfg = dict(DEFAULTS)
    try:
        if CONFIG_PATH.is_file():
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except Exception as e:
        server.log("config error (%s): %s" % (CONFIG_PATH, e))
    return cfg


def ensure_config(cfg):
    if not CONFIG_PATH.is_file():
        try:
            CONFIG_PATH.write_text(json.dumps(DEFAULTS, indent=2), encoding="utf-8")
        except OSError:
            pass


def icon_path():
    candidates = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / "app.ico")
    candidates.append(ROOT / "app.ico")
    for p in candidates:
        if p.is_file():
            return str(p)
    return None


def main():
    cfg = load_config()
    ensure_config(cfg)

    db_path = (cfg.get("dbPath") or "").strip()
    if db_path:
        server.DB_PATH = Path(db_path)
    if not server.DB_PATH.exists():
        server.log("WARNING: opencode database not found: %s" % server.DB_PATH)

    srv, port = server.make_server(cfg.get("host", "127.0.0.1"), int(cfg.get("port", 0)))
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()

    try:
        import webview
    except ImportError:
        server.log("pywebview is not installed. Install it with: py -m pip install pywebview")
        sys.exit(1)

    url = "http://127.0.0.1:%d/" % port
    server.log("Opening desktop window -> %s (config: %s)" % (url, CONFIG_PATH))

    try:
        webview.create_window(
            APP_NAME,
            url,
            width=int(cfg.get("width", 1440)),
            height=int(cfg.get("height", 900)),
            min_size=(int(cfg.get("minWidth", 980)), int(cfg.get("minHeight", 640))),
        )
        webview.start(icon=icon_path())
    except Exception as e:
        server.log("Failed to open desktop window: %s" % e)
        if "WebView2" in str(e):
            server.log(
                "The Microsoft Edge WebView2 runtime is required (preinstalled on most "
                "Windows 10/11). Install it from https://developer.microsoft.com/microsoft-edge/webview2/"
            )
        sys.exit(1)
    finally:
        server.log("Closing server.")
        srv.shutdown()


if __name__ == "__main__":
    main()
