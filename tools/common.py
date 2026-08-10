#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared helpers for the tools/ scripts (paths, liveness, config)."""

import os
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER_MODULE = "server_app.httpd"
TOOLS_DIR = ROOT / "tools"
RUNTIME_DIR = ROOT / "runtime"
LOG_DIR = RUNTIME_DIR / "logs"
PID_FILE = LOG_DIR / "server.pid"
EXPORT_DIR = RUNTIME_DIR / "exports"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8124

DB_PATH = Path.home() / ".local" / "share" / "opencode" / "opencode.db"
MODELS_CACHE = Path.home() / ".cache" / "opencode" / "models.json"

def _skills_dir():
    """OpenCode skills directory (env override, else standard user location)."""
    env = os.environ.get("OPENCODE_SKILLS_DIR")
    if env:
        return Path(env)
    return Path.home() / ".config" / "opencode" / "skills"


SKILLS_DIR = _skills_dir()


def ensure_dirs():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)


def read_pid():
    try:
        return int(PID_FILE.read_text().strip())
    except Exception:
        return None


def write_pid(pid):
    ensure_dirs()
    PID_FILE.write_text(str(pid))


def clear_pid():
    try:
        PID_FILE.unlink()
    except OSError:
        pass


def port_open(host=DEFAULT_HOST, port=DEFAULT_PORT, timeout=0.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def fetch_health(port=DEFAULT_PORT, timeout=2):
    import json
    import urllib.request

    try:
        with urllib.request.urlopen(
            "http://%s:%d/api/health" % (DEFAULT_HOST, port), timeout=timeout
        ) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def kill_pid(pid):
    import signal

    if not pid:
        return False
    try:
        os.kill(pid, signal.SIGTERM)
        return True
    except Exception:
        pass
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                check=True,
                capture_output=True,
            )
            return True
        except Exception:
            pass
    return False


def pid_by_port(port=DEFAULT_PORT):
    """Best-effort PID of the process listening on a TCP port (Windows)."""
    if os.name != "nt":
        return None
    try:
        out = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=10
        ).stdout
    except Exception:
        return None
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0] == "TCP":
            addr = parts[1]
            if addr.endswith(":%d" % port) and parts[3] == "LISTENING":
                return int(parts[4])
    return None
