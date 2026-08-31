#!/usr/bin/env bash
# finish.sh -- verify a dispatch's worktree, then merge it or discard it.
#
# Usage: agent-runs/finish.sh <N> [--merge | --discard]
#   agent-runs/finish.sh 76             # verify only, report, change nothing
#   agent-runs/finish.sh 76 --merge     # verify, then merge to master and clean up
#   agent-runs/finish.sh 76 --discard   # throw the branch and worktree away
#
# Verification runs HERE, in this script, against the dispatch's own tree --
# never by reading the dispatch's own summary. agent-runs/README.md records why:
# every dispatch is told to run tsc and the tests itself, and a "done" summary
# has repeatedly been wrong. `npm test` in the worktree is evidence; a paragraph
# claiming it passed is not.
#
# --merge refuses on a dirty main tree and refuses if verification fails. Both
# refusals are the point: merging unverified work is how a regression gets
# attributed to the wrong dispatch.

set -euo pipefail

MODE="verify"
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --merge) MODE="merge" ;;
        --discard) MODE="discard" ;;
        *) ARGS+=("$arg") ;;
    esac
done

if [ "${#ARGS[@]}" -ne 1 ]; then
    echo "Usage: $0 <dispatch-number> [--merge | --discard]" >&2
    exit 1
fi

NUM="${ARGS[0]}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$MAIN_ROOT")"
BRANCH="dispatch/${NUM}"
RUN_DIR="$(dirname "$MAIN_ROOT")/${REPO_NAME}-dispatch-${NUM}"

if [ ! -d "$RUN_DIR" ]; then
    echo "No worktree at $RUN_DIR -- nothing to finish." >&2
    exit 1
fi

# Is an agy running *in this worktree*? Checking for any agy at all was the first version and it
# was wrong: with a hard limit of two concurrent dispatches, a second one is running most of the
# time, so that check refused every finish during normal operation. Each agy inherits its
# worktree as its cwd, so /proc/<pid>/cwd is the real answer.
OWN_AGY=""
for pid in $(pgrep -f '^agy ' 2>/dev/null || true); do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$(readlink -f "$RUN_DIR")" ]; then
        OWN_AGY="$OWN_AGY $pid"
    fi
done

if [ -n "$OWN_AGY" ]; then
    echo "WARNING: agy is still running IN THIS WORKTREE (PID(s):$OWN_AGY)."
    echo "Finishing now would act on a half-written tree."
    if [ "$MODE" != "verify" ]; then
        echo "Refusing to $MODE while this dispatch is still running." >&2
        exit 1
    fi
fi

if [ "$MODE" = "discard" ]; then
    echo "Discarding $BRANCH and $RUN_DIR..."
    git -C "$MAIN_ROOT" worktree remove --force "$RUN_DIR"
    git -C "$MAIN_ROOT" branch -D "$BRANCH"
    echo "Discarded. The result log in agent-runs/results/ is kept."
    exit 0
fi

echo "=== Changes on $BRANCH ==="
git -C "$RUN_DIR" add -A
git -C "$MAIN_ROOT" diff --stat "master...$BRANCH" || true
git -C "$RUN_DIR" diff --cached --stat

echo
echo "=== Casts a dispatch should never have introduced ==="
# agy reaches for these repeatedly on calls the framework already types correctly
# (agent-runs/README.md). Cheap to check, and it has caught dozens.
if git -C "$RUN_DIR" diff --cached -U0 | grep -E '^\+' | grep -nE 'as any|as never|as unknown as' ; then
    echo "^^ found -- review each one before merging."
else
    echo "none"
fi

# Verification output goes to a file as well as the terminal. "TESTS FAILED" with no record of
# WHICH tests failed is not a usable result -- the first version of this script printed exactly
# that, and answering "is this failure pre-existing or did the dispatch cause it" then meant
# re-running the whole six-minute suite.
VERIFY_LOG="$SCRIPT_DIR/results/${NUM}-verify.log"
: > "$VERIFY_LOG"

echo
echo "=== npx tsc --noEmit ==="
TSC_OK=1
(cd "$RUN_DIR" && npx tsc --noEmit) 2>&1 | tee -a "$VERIFY_LOG" || true
if grep -qE '^[^ ].*error TS' "$VERIFY_LOG"; then TSC_OK=0; fi
[ "$TSC_OK" -eq 1 ] && echo "tsc clean" || echo "TSC FAILED"

echo
echo "=== npm test ==="
TEST_OK=1
(cd "$RUN_DIR" && npm test) > >(tee -a "$VERIFY_LOG") 2>&1 || TEST_OK=0
[ "$TEST_OK" -eq 1 ] && echo "tests passed" || echo "TESTS FAILED"

if [ "$TEST_OK" -eq 0 ]; then
    echo
    echo "--- failing test files ---"
    grep -E '^ *(FAIL|❯|×)' "$VERIFY_LOG" | sort -u | head -40
    echo "(full output: $VERIFY_LOG)"
fi

if [ "$MODE" = "verify" ]; then
    echo
    echo "Verify-only. Nothing merged. Re-run with --merge when satisfied."
    exit 0
fi

if [ "$TSC_OK" -eq 0 ] || [ "$TEST_OK" -eq 0 ]; then
    echo
    echo "Refusing to merge: verification failed above." >&2
    exit 1
fi

if [ -n "$(git -C "$MAIN_ROOT" status --porcelain)" ]; then
    echo
    echo "Refusing to merge: the main tree has uncommitted changes." >&2
    echo "Commit or stash them first -- merging on top would mix them into this dispatch's history." >&2
    exit 1
fi

echo
echo "Committing the dispatch's work on $BRANCH..."
if [ -n "$(git -C "$RUN_DIR" status --porcelain)" ]; then
    git -C "$RUN_DIR" commit -q -m "Dispatch ${NUM}: $(basename "$(find "$SCRIPT_DIR/prompts" -maxdepth 1 -name "${NUM}-*.prompt.txt" | head -1)" .prompt.txt | cut -d- -f2-)"
fi

echo "Merging $BRANCH into master..."
git -C "$MAIN_ROOT" merge --no-ff "$BRANCH" -m "Merge dispatch ${NUM}"
git -C "$MAIN_ROOT" worktree remove --force "$RUN_DIR"
git -C "$MAIN_ROOT" branch -d "$BRANCH"
echo "Merged and cleaned up."
