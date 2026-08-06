# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['D:\\Apps\\AI\\Project\\dashboard-token\\app\\desktop.py'],
    pathex=['D:\\Apps\\AI\\Project\\dashboard-token'],
    binaries=[],
    datas=[('D:\\Apps\\AI\\Project\\dashboard-token\\index.html', '.'), ('D:\\Apps\\AI\\Project\\dashboard-token\\static', 'static'), ('D:\\Apps\\AI\\Project\\dashboard-token\\app\\app.ico', '.'), ('D:\\Apps\\AI\\Project\\dashboard-token\\graphify-out\\graph.json', 'graphify-out'), ('D:\\Apps\\AI\\Project\\dashboard-token\\graphify-out\\views', 'graphify-out/views')],
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
    name='TokenMetrics',
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
    icon=['D:\\Apps\\AI\\Project\\dashboard-token\\app\\app.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='TokenMetrics',
)
