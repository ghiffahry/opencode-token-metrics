#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Start the Token Metrics bridge (server.py) as a detached background process.

Usage:
  py tools/start.py            # default port 8124
  py tools/start.py --port 9000 --host 0.0.0.0
"""

import argparse
import os
import subprocess
import sys
import time

import common

LOG_FILE = common.LOG_DIR / "server.log"


def spawn(port, host):
    common.ensure_dirs()
    logf = open(LOG_FILE, "ab", buffering=0)
    kwargs = dict(
        stdout=logf,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        cwd=str(common.ROOT),
        close_fds=True,
    )
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(
        [sys.executable, str(common.SERVER_PY), "--port", str(port), "--host", host],
        **kwargs
    )
    logf.close()
    common.write_pid(proc.pid)
    return proc


def main():
    ap = argparse.ArgumentParser(description="Start the Token Metrics bridge detached")
    ap.add_argument("--port", type=int, default=common.DEFAULT_PORT)
    ap.add_argument("--host", default=common.DEFAULT_HOST)
    args = ap.parse_args()

    if common.port_open(args.host, args.port):
        print("Already running on http://%s:%d/ (port is open)." % (args.host, args.port))
        return

    proc = spawn(args.port, args.host)
    print("Spawned PID %d, log: %s" % (proc.pid, LOG_FILE))

    for _ in range(25):
        if common.port_open(args.host, args.port):
            print("OK  -> http://%s:%d/  (API: /api/health)" % (args.host, args.port))
            return
        time.sleep(0.2)
    print("Server did not open port %d in time. Check %s" % (args.port, LOG_FILE))
    sys.exit(1)


if __name__ == "__main__":
    main()
