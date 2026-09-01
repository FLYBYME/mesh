#!/usr/bin/env bash
# dispatch.sh -- launches an agy build dispatch by number, isolated in its own git worktree.
#
# Usage: agent-runs/dispatch.sh <N> [--shared-tree]
#   e.g. agent-runs/dispatch.sh 76
#
# Finds agent-runs/prompts/<N>-*.prompt.txt, creates a dedicated git worktree on
# branch dispatch/<N>, launches agy inside it in the background
# (--dangerously-skip-permissions, required for an unattended background run --
# see agent-runs/README.md), and writes its output to the main tree's
# agent-runs/results/<N>-*.result.md.
#
# WHY THE WORKTREE (roadmap D14, raised 2026-08-28):
# Dispatches #112-#118 all layered directly onto one shared, uncommitted working
# tree. When a regression appeared it was genuinely unclear which dispatch caused
# it, because three sets of edits were interleaved in the same files with no
# boundary between them. A worktree per dispatch gives each one its own branch,
# its own working tree, and its own diff -- so "what did this dispatch change" is
# answerable by `git diff master...dispatch/N` instead of by guesswork.
#
# It also separates the test databases. Every dispatch runs `npm test` against
# MONGODB_URI, which points at one shared database; two concurrent dispatches were
# dropping and reseeding each other's collections mid-run. Each worktree gets its
# own database name, so a concurrent run cannot corrupt another's fixtures.
#
# Pass --shared-tree to run the old way, directly against the main working tree.
# Only for a dispatch that must see another's uncommitted work.

set -euo pipefail

SHARED_TREE=0
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --shared-tree) SHARED_TREE=1 ;;
        *) ARGS+=("$arg") ;;
    esac
done

if [ "${#ARGS[@]}" -ne 1 ]; then
    echo "Usage: $0 <dispatch-number> [--shared-tree]" >&2
    exit 1
fi

NUM="${ARGS[0]}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROMPT_FILE="$(find "$SCRIPT_DIR/prompts" -maxdepth 1 -name "${NUM}-*.prompt.txt" | head -1)"
if [ -z "$PROMPT_FILE" ]; then
    echo "No prompt file found matching agent-runs/prompts/${NUM}-*.prompt.txt" >&2
    exit 1
fi

BASENAME="$(basename "$PROMPT_FILE" .prompt.txt)"
# The log lives in the MAIN tree, never the worktree -- a worktree gets removed
# after merge, and taking the only record of what the dispatch did with it would
# be the one irreversible part of this whole flow.
# .md, not .log: agy's final output is Markdown, and the human reads these on GitHub from a
# phone. A .log renders as a wall of monospace with the headings, links and code fences shown as
# literal characters; the same bytes named .md render as the report agy actually wrote.
RESULT_FILE="$SCRIPT_DIR/results/${BASENAME}.result.md"

RUNNING=0
if pgrep -f '^agy ' > /dev/null 2>&1; then
    RUNNING="$(pgrep -cf '^agy ')"
fi
if [ "$RUNNING" -ge 2 ]; then
    echo "Refusing to dispatch: $RUNNING agy process(es) already running (hard limit: 2 concurrent)." >&2
    echo "Check with: pgrep -f '^agy '" >&2
    exit 1
fi

if [ "$SHARED_TREE" -eq 1 ]; then
    RUN_DIR="$MAIN_ROOT"
    echo "Dispatching $BASENAME against the SHARED working tree (no isolation)..."
else
    REPO_NAME="$(basename "$MAIN_ROOT")"
    BRANCH="dispatch/${NUM}"
    RUN_DIR="$(dirname "$MAIN_ROOT")/${REPO_NAME}-dispatch-${NUM}"

    if [ -d "$RUN_DIR" ]; then
        echo "Worktree already exists at $RUN_DIR" >&2
        echo "Finish or discard it first: agent-runs/finish.sh ${NUM}" >&2
        exit 1
    fi

    echo "Creating worktree $RUN_DIR on branch $BRANCH (from $(git -C "$MAIN_ROOT" rev-parse --short HEAD))..."
    git -C "$MAIN_ROOT" worktree add -b "$BRANCH" "$RUN_DIR" HEAD >/dev/null

    # node_modules is gitignored, so a fresh worktree has none and `npm ci` would
    # cost minutes per dispatch. The dependency set is identical by construction
    # (the worktree branches from HEAD), so the tree is hard-linked instead:
    # ~0.8s, and no meaningful disk since every file shares the original's inode.
    #
    # NOT a symlink, which was tried first and broke two things. TypeScript
    # resolves through a symlinked node_modules to its real path outside the
    # worktree and then fails every inferred zod type with TS2883 "cannot be
    # named without a reference to ... This is likely not portable" -- so `tsc`
    # passed in the main tree and failed in the worktree for no real reason. And
    # `.gitignore`'s `node_modules/` does not match a symlink named
    # `node_modules`, so `git add -A` staged it as a tracked file.
    cp -al "$MAIN_ROOT/node_modules" "$RUN_DIR/node_modules"

    # .env is gitignored too, and the tests genuinely need it (vitest.config.ts
    # loads it via dotenv/config). Copy it, then point this dispatch at its own
    # Mongo database so concurrent runs cannot drop each other's collections.
    if [ -f "$MAIN_ROOT/.env" ]; then
        sed -E "s#^(MONGODB_URI=\")([^\"]*/)[^\"/]*(\")#\1\2mesh_dispatch_${NUM}\3#" \
            "$MAIN_ROOT/.env" > "$RUN_DIR/.env"
        echo "Test database: $(grep -m1 '^MONGODB_URI=' "$RUN_DIR/.env" | cut -d/ -f4- | tr -d '\"')"
    fi

    echo "Dispatching $BASENAME in its own worktree..."
fi

cd "$RUN_DIR"

nohup agy -p "$(cat "$PROMPT_FILE")" \
    --dangerously-skip-permissions --print-timeout 120m0s \
    > "$RESULT_FILE" 2>&1 &
AGY_PID=$!
disown

sleep 2
if ! kill -0 "$AGY_PID" 2>/dev/null; then
    echo "FAILED to start -- check $RESULT_FILE" >&2
    exit 1
fi

# Every running agy must be sitting in the worktree it was dispatched into.
# Roadmap D38: dispatches #141 and #142 were launched seconds apart and BOTH ran
# in #142's checkout -- #141 started first, did all its work in the later
# dispatch's tree, and left its own worktree empty. Neither result log mentions
# paas-dispatch-141 at all. That silently defeats the per-dispatch isolation this
# script exists to provide (D14): two dispatches' edits interleaved in one tree,
# which is exactly the state that made attributing a regression guesswork before.
#
# So verify it rather than assume it, against the PID this script actually
# launched. /proc/<pid>/cwd is the real answer -- the same check finish.sh uses
# to tell whose agy is whose.
#
# CAVEAT, so nobody trusts this further than it goes: this catches the collision
# only if the cause is the process's working directory. If agy is instead sharing
# some session or workspace state between concurrent instances -- which the
# observed order fits better, since #141 started FIRST and still ended up in
# #142's tree -- then cwd will look correct here and the collision will happen
# anyway. Until the root cause is known, dispatching one at a time is the only
# actual guarantee.
echo "Dispatched. PID: $AGY_PID"
echo "Tree: $RUN_DIR"
echo "Log:  $RESULT_FILE"

AGY_CWD="$(readlink -f "/proc/$AGY_PID/cwd" 2>/dev/null || true)"
if [ -n "$AGY_CWD" ] && [ "$AGY_CWD" != "$(readlink -f "$RUN_DIR")" ]; then
    echo
    echo "WARNING (D38): this dispatch's agy is not in the worktree it was given." >&2
    echo "  expected: $(readlink -f "$RUN_DIR")" >&2
    echo "  actual:   $AGY_CWD" >&2
    echo "Its work will land in the wrong tree, interleaved with whatever is running" >&2
    echo "there. Kill PID $AGY_PID and dispatch it on its own." >&2
fi
if [ "$SHARED_TREE" -eq 0 ]; then
    echo "Review with: git -C \"$MAIN_ROOT\" diff master...dispatch/${NUM}"
    echo "Finish with: agent-runs/finish.sh ${NUM}"
fi
