#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-command helper to record every revision as a git commit.

Stages all tracked changes (respecting .gitignore), refreshes the knowledge
graph (unless --no-graph), then commits with a conventional-commit message.

Usage:
  py tools/git_commit.py -m "message"
  py tools/git_commit.py --type feat -m "add widget"
  py tools/git_commit.py              # interactive prompt
  py tools/git_commit.py --dry-run    # show diff stat, no commit
  py tools/git_commit.py --no-graph   # skip graphify update
"""

import argparse
import subprocess
import sys

import common

TYPES = ("feat", "fix", "perf", "chore", "docs", "refactor", "test", "build")


def run(cmd, check=True):
    return subprocess.run(cmd, capture_output=True, text=True)


def graphify_update():
    cmd = ["graphify", "update", "."]
    try:
        r = run(cmd)
    except OSError as e:
        print("WARNING: cannot run graphify update (%s) — continuing." % e)
        return
    if r.returncode == 0:
        for line in r.stdout.splitlines()[-2:]:
            print("  " + line)
    else:
        print("WARNING: graphify update failed (continuing):")
        print(r.stderr[-500:] if r.stderr else r.stdout[-500:])


def main():
    ap = argparse.ArgumentParser(description="Stage and commit the current revision")
    ap.add_argument("-m", "--message", default=None, help="Commit message (skip for prompt)")
    ap.add_argument("--type", choices=TYPES, default=None,
                    help="Conventional-commit type prefix (feat, fix, ...)")
    ap.add_argument("--no-graph", action="store_true", help="Skip graphify update")
    ap.add_argument("--dry-run", action="store_true", help="Show changes without committing")
    args = ap.parse_args()

    status = run(["git", "status", "--short"])
    changed = [l for l in status.stdout.splitlines() if l.strip()]
    if not changed:
        print("No changes to commit — working tree clean.")
        return

    print("Changes:")
    print(status.stdout or "(none)")
    diffstat = run(["git", "diff", "--stat"])
    if diffstat.stdout.strip():
        print(diffstat.stdout)

    if args.dry_run:
        print("--dry-run: not staging or committing.")
        return

    if not args.no_graph:
        print("Refreshing knowledge graph…")
        graphify_update()

    run(["git", "add", "-A"], check=True)
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

    r = run(["git", "commit", "-m", message])
    print(r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr.strip())
        sys.exit(1)
    print("Committed.")


if __name__ == "__main__":
    main()
