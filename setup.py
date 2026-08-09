"""Build staging: copy dashboard web assets into the package so wheels are
self-contained (server_app/web/). The copy is git-ignored; source checkouts
keep serving from the repo root via config._base_dir()."""

import shutil
from pathlib import Path

from setuptools import setup

HERE = Path(__file__).resolve().parent
PKG = HERE / "server_app"
WEB = PKG / "web"


def stage():
    if WEB.exists():
        shutil.rmtree(WEB)
    WEB.mkdir()
    shutil.copy2(HERE / "index.html", WEB / "index.html")
    shutil.copytree(HERE / "static", WEB / "static")


stage()
setup()
