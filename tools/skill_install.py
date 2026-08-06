#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Install the graphify CLI and its OpenCode skill.

Steps:
  1. Ensure the CLI is installed (uv tool install graphifyy,
     fallback pipx, then pip --user).
  2. Copy the packaged OpenCode skill (SKILL.md + references/)
     into SKILLS_DIR/graphify.
  3. Register the skill/plugin for OpenCode via `graphify opencode install`.

Idempotent: each step is skipped if already satisfied.
"""

import shutil
import subprocess
import sys
from pathlib import Path

from common import SKILLS_DIR

GRAPHIFY_NAME = "graphify"
PYPI_PACKAGE = "graphifyy"
SKILL_TARGET = SKILLS_DIR / GRAPHIFY_NAME
SKILL_MD_NAME = "SKILL.md"


def run(cmd, check=True):
    print("  > %s" % " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def which(bin_name):
    return shutil.which(bin_name)


def ensure_cli():
    if which(GRAPHIFY_NAME):
        print("CLI already installed: %s" % which(GRAPHIFY_NAME))
        return
    print("Installing %s CLI via uv..." % GRAPHIFY_NAME)
    try:
        run(["uv", "tool", "install", PYPI_PACKAGE])
    except subprocess.CalledProcessError:
        print("  uv failed; trying pipx...")
        try:
            run(["pipx", "install", PYPI_PACKAGE])
        except subprocess.CalledProcessError:
            print("  pipx failed; trying pip --user...")
            run([sys.executable, "-m", "pip", "install", "--user", PYPI_PACKAGE])
    if not which(GRAPHIFY_NAME):
        sys.exit("ERROR: '%s' still not on PATH after install." % GRAPHIFY_NAME)


def package_skill_dir():
    """Locate the graphify package inside the uv tool env."""
    tools_root = None
    try:
        r = run(["uv", "tool", "dir"], check=False)
        if r.returncode == 0 and r.stdout.strip():
            tools_root = Path(r.stdout.strip())
    except Exception:
        pass
    if tools_root:
        for tool_dir in (PYPI_PACKAGE, GRAPHIFY_NAME):
            for lib in ("Lib", "lib"):
                pkg = tools_root / tool_dir / lib / "site-packages" / GRAPHIFY_NAME
                if pkg.exists():
                    return pkg
    for cand in [which(GRAPHIFY_NAME)]:
        if cand:
            exe = Path(cand)
            return exe.parent.parent / "Lib" / "site-packages" / GRAPHIFY_NAME
    sys.exit("ERROR: could not locate the packaged graphify skill files.")


def copy_skill(pkg):
    src_md = pkg / "skill-opencode.md"
    src_refs = pkg / "skills" / "opencode" / "references"
    if not src_md.exists():
        sys.exit("ERROR: %s not found in package." % src_md)
    dst_md = SKILL_TARGET / SKILL_MD_NAME
    dst_refs = SKILL_TARGET / "references"

    if dst_md.exists() and dst_md.read_bytes() == src_md.read_bytes():
        print("Skill already up to date: %s" % SKILL_TARGET)
    else:
        SKILL_TARGET.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_md, dst_md)
        print("Copied %s -> %s" % (src_md.name, dst_md))
    if src_refs.exists():
        dst_refs.mkdir(parents=True, exist_ok=True)
        for f in src_refs.iterdir():
            if f.is_file():
                shutil.copy2(f, dst_refs / f.name)
        print("Synced references (%d files)" % len(list(src_refs.glob("*"))))
    else:
        print("  (no references/ shipped in package)")


def register():
    print("Registering with OpenCode via `graphify opencode install`...")
    try:
        r = run([GRAPHIFY_NAME, "opencode", "install"])
        print(r.stdout.strip())
    except subprocess.CalledProcessError as e:
        print("  command failed (rc=%d): %s" % (e.returncode, e.stderr.strip()))


def verify():
    r = run([GRAPHIFY_NAME, "--version"], check=False)
    print("graphify --version -> %s" % (r.stdout.strip() or r.stderr.strip()))
    if SKILL_TARGET.exists():
        for f in sorted(SKILL_TARGET.rglob("*")):
            if f.is_file():
                print("  %s" % f.relative_to(SKILL_TARGET))


def main():
    print("[1/3] CLI")
    ensure_cli()
    print("[2/3] Skill files -> %s" % SKILL_TARGET)
    pkg = package_skill_dir()
    print("  package: %s" % pkg)
    copy_skill(pkg)
    print("[3/3] OpenCode registration")
    register()
    print("Done.")
    verify()


if __name__ == "__main__":
    main()
