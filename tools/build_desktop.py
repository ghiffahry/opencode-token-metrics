import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_DIR = ROOT / "runtime"
APP_DIR = ROOT / "app"
TOOLS_DIR = ROOT / "tools"

NAME = "TokenMetrics"
ENTRY = APP_DIR / "desktop.py"
ICON = APP_DIR / "app.ico"

DATAS = [
    (ROOT / "web" / "index.html", "."),
    (ROOT / "web" / "static", "static"),
    (APP_DIR / "app.ico", "."),
]

OPTIONAL_DATAS = [
    (ROOT / "graphify-out" / "graph.json", "graphify-out"),
    (ROOT / "graphify-out" / "views", "graphify-out/views"),
]


def check_prereqs():
    missing = []
    if not ENTRY.is_file():
        missing.append("app/desktop.py")
    if not (ROOT / "web" / "index.html").is_file():
        missing.append("web/index.html")
    if not ICON.is_file():
        missing.append("app/app.ico")
    for src, _ in DATAS:
        if not src.exists():
            missing.append(str(src))
    if missing:
        print("Missing files:\n  " + "\n  ".join(missing))
        return False
    if shutil.which("pyinstaller") is None:
        print("pyinstaller not found. Install with: py -m pip install pyinstaller")
        return False
    return True


def command():
    args = [
        "pyinstaller",
        "--noconfirm",
        "--clean",
        "--windowed",
        "--name", NAME,
        "--icon", str(ICON),
        "--paths", str(ROOT),
        "--specpath", str(TOOLS_DIR),
        "--distpath", str(RUNTIME_DIR / "dist"),
        "--workpath", str(RUNTIME_DIR / "build"),
    ]
    all_datas = DATAS + [d for d in OPTIONAL_DATAS if d[0].exists()]
    for src, dst in all_datas:
        args += ["--add-data", "%s;%s" % (src, dst)]
    args.append(str(ENTRY))
    return args


def main():
    ap = argparse.ArgumentParser(description="Build Token Metrics desktop app")
    ap.add_argument("--build", action="store_true", help="run PyInstaller (default: print the command)")
    args = ap.parse_args()

    if not check_prereqs():
        sys.exit(1)

    cmd = command()
    if not args.build:
        print("Dev mode (no build). Command that would run:\n")
        print("  " + " ".join(cmd))
        print("\nRe-run with --build to execute it.")
        return

    print("Running: " + " ".join(cmd))
    subprocess.run(cmd, cwd=str(ROOT), check=True)
    print("\nDone. App at: %s" % (RUNTIME_DIR / "dist" / NAME / (NAME + ".exe")))


if __name__ == "__main__":
    main()
