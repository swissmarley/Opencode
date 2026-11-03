#!/bin/sh
# Merges the latest upstream opencode (anomalyco/opencode, branch dev) into the current branch.
#
# Upstream's GitHub Actions workflows are deleted again after every merge: they deploy, release and triage
# opencode itself, and on this fork they would only spend Actions minutes or fail on missing secrets. Workflows
# you add under names upstream doesn't use are kept.
set -eu

upstream_url="https://github.com/anomalyco/opencode.git"
upstream_branch="dev"

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "You have uncommitted changes. Commit or stash them, then run this again." >&2
  exit 1
fi

git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$upstream_url"
git fetch upstream "$upstream_branch"

if git merge-base --is-ancestor "upstream/$upstream_branch" HEAD; then
  echo "Already up to date with upstream/$upstream_branch."
  exit 0
fi

# A conflicted merge exits non-zero, and git's own message would also count the workflow files this script resolves,
# so its output is hidden and the remaining conflicts are reported below.
git merge --no-ff --no-commit "upstream/$upstream_branch" >/dev/null 2>&1 || true
if ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  echo "Could not start merging upstream/$upstream_branch. Run 'git merge upstream/$upstream_branch' to see why." >&2
  exit 1
fi
git ls-tree -r --name-only "upstream/$upstream_branch" -- .github/workflows | while IFS= read -r workflow; do
  git rm -q -f --ignore-unmatch -- "$workflow"
done

conflicts="$(git diff --name-only --diff-filter=U)"
if [ -n "$conflicts" ]; then
  echo
  echo "Upstream changed the same lines as this fork in these files:"
  echo "$conflicts" | sed 's/^/  /'
  echo
  echo "Fix each file (keep both changes where you can), then run:"
  echo "  git add <file>      for every fixed file"
  echo "  git commit --no-edit"
  echo "To give up on this update instead: git merge --abort"
  exit 1
fi

git commit -q --no-edit
echo "Merged upstream/$upstream_branch. Next: run 'bun install', check that things work, then push."
