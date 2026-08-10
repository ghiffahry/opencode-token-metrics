# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the desktop app. Prefer `py tools/build_desktop.py`,
# which builds the same bundle from CLI flags; this spec is kept for
# `pyinstaller tools/TokenMetrics.spec` use and is portable: all paths are
# derived from this file, never absolute machine paths.

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / "app" / "desktop.py"
ICON = ROOT / "app" / "app.ico"

datas = [
    (str(ROOT / "web" / "index.html"), "."),
    (str(ROOT / "web" / "static"), "static"),
    (str(ICON), "."),
]
# Graph data is optional: bundled only when graphify-out/ exists so the
# graph section is gracefully omitted from builds without it.
for src in (ROOT / "graphify-out" / "graph.json", ROOT / "graphify-out" / "views"):
    if src.exists():
        datas.append((str(src), "graphify-out"))

a = Analysis(
    [str(ENTRY)],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TokenMetrics",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[str(ICON)],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="TokenMetrics",
)
