#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Token Metrics - OpenCode local bridge (package shim).

The implementation lives in the `server_app` package (config, db, ranges,
estimates, overview, context, routes, httpd). This module keeps the old
`import server` and `py server.py` entry points working unchanged.

Run:  py server.py            (default port 8124)
      py server.py --port 9000
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server_app import *  # noqa: F401,F403  (re-exports the public API)
from server_app.httpd import main  # noqa: F401


if __name__ == "__main__":
    main()
