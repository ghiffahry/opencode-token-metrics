#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-command helper to record every revision as a git commit.

Stages all tracked changes (respecting .gitignore) and commits with a
conventional-commit message.

Usage:
  py tools/git_commit.py -m "message"
  py tools/git_commit.py --type feat -m "add widget"
  py tools/git_commit.py              # interactive prompt
  py tools/git_commit.py --dry-run    # show diff stat, no commit
"""

import argparse
import subprocess
import sys

TYPES = ("feat", "fix", "perf", "chore", "docs", "refactor", "test", "build")


def main():
    ap = argparse.ArgumentParser(description="Stage and commit the current revision")
    ap.add_argument("-m", "--message", default=None, help="Commit message (skip for prompt)")
    ap.add_argument("--type", choices=TYPES, default=None,
                    help="Conventional-commit type prefix (feat, fix, ...)")
    ap.add_argument("--dry-run", action="store_true", help="Show changes without committing")
    args = ap.parse_args()

    status = subprocess.run(["git", "status", "--short"], capture_output=True, text=True)
    changed = [l for l in status.stdout.splitlines() if l.strip()]
    if not changed:
        print("No changes to commit — working tree clean.")
        return

    print("Changes:")
    print(status.stdout or "(none)")
    diffstat = subprocess.run(["git", "diff", "--stat"], capture_output=True, text=True)
    if diffstat.stdout.strip():
        print(diffstat.stdout)

    if args.dry_run:
        print("--dry-run: not staging or committing.")
        return

    subprocess.run(["git", "add", "-A"], check=True)
    print("Staged %d file(s)." % len(changed))

    message = args.message
    if not message:
        try:
            message = input("Commit message: ").strip()
        except EOFError:
            message = ""
    if not message:
        print("Aborted: empty commit message.")
        return
    if args.type:
        message = "%s: %s" % (args.type, message)

    r = subprocess.run(["git", "commit", "-m", message], capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr.strip())
        sys.exit(1)
    print("Committed.")


if __name__ == "__main__":
    main()
