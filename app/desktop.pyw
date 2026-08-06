#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Double-click launcher: runs desktop.py with pythonw (no console window)."""

import os
import runpy
import sys

here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)
sys.path.insert(0, here)
runpy.run_path(os.path.join(here, "desktop.py"), run_name="__main__")
