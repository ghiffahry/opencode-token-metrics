from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / "app" / "desktop.py"
ICON = ROOT / "app" / "app.ico"

datas = [
    (str(ROOT / "web" / "index.html"), "."),
    (str(ROOT / "web" / "static"), "static"),
    (str(ICON), "."),
]

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
