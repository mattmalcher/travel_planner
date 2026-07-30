#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (claude.ai/code, and the
# Code tab in the Claude iOS/Android app).
#
# A cloud session is a fresh clone with no node_modules, and the desktop CLI's
# first move — `npm run itin -- validate` — needs ajv. Without this the skills
# in .claude/skills/ load fine and then fail on their first command, which
# reads as "the tooling is broken" rather than "nothing is installed".
#
# No-op on the user's own machine: a local checkout has already been through
# `make install`, and a hook that reinstalls on every session start would be a
# tax on the surface that does not need it.
#
# Deliberately NOT installing Playwright browsers. The e2e suite is not what a
# phone-driven authoring session runs, the download is ~100 MB, and CLAUDE.md
# documents an extract hang in `npx playwright install` that is no fun to hit
# at session start. `make lint` and `make test-unit` both work after this.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# install, not ci: the container image is cached after the hook completes, so
# an install that can reuse what is already there is the cheaper one.
npm install --no-audit --no-fund

echo "Ready: npm run itin -- --help, make validate, make test-unit"
