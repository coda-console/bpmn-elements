#!/bin/bash
# What a change to the coda branch passes before it merges, the same here and in the check workflow
# (.coda/workflows/check.bpmn): the whole mocha suite, lint, the types, and a dist/ that is what src/ builds to
# (Coda installs this repository from Git without building it).
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --no-audit --no-fund --loglevel=error
npx mocha -R dot -p -t 3000
npm run lint
npm run typecheck
npm run dist >/dev/null
changed=$(git status --porcelain -- dist types)
if [ -n "$changed" ]; then
  echo "提交的 dist/ 与 src/ 构建出的不一致：先 npm run dist 再提交" >&2
  echo "$changed" >&2
  exit 1
fi
echo "检查通过"
