#!/usr/bin/env bash
# Sync the current working tree to the workspace and (re)deploy the Databricks App.
# Usage: npm run deploy
#   DBX_APP overrides the app name (default: meddesert)
#   DATABRICKS_CLI overrides the CLI path (else: PATH, then ~/.local/bin/databricks)
# Notes:
#   - `databricks sync` respects .gitignore, so node_modules/.next/.env.local/JUDGE_ACCESS.md
#     and screenshots are excluded automatically.
#   - Deploys whatever is checked out — make sure you're on the branch you want live.
set -euo pipefail

APP="${DBX_APP:-meddesert}"

# Locate the databricks CLI.
DB="${DATABRICKS_CLI:-}"
if [ -z "$DB" ]; then
  if command -v databricks >/dev/null 2>&1; then DB="databricks"
  elif [ -x "$HOME/.local/bin/databricks" ]; then DB="$HOME/.local/bin/databricks"
  else echo "error: databricks CLI not found (set DATABRICKS_CLI or add it to PATH)"; exit 1; fi
fi

# Derive the per-user workspace source path from the authenticated identity.
EMAIL="$("$DB" current-user me -o json | sed -n 's/.*"userName": *"\([^"]*\)".*/\1/p' | head -1)"
if [ -z "$EMAIL" ]; then echo "error: not authenticated (run: $DB auth login --host <workspace>)"; exit 1; fi
WS="/Workspace/Users/$EMAIL/$APP"

echo "==> Syncing $(pwd) -> $WS"
"$DB" sync . "$WS"

echo "==> Deploying app '$APP' from $WS"
"$DB" apps deploy "$APP" --source-code-path "$WS"

echo "==> Done. App: $("$DB" apps get "$APP" -o json | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' | head -1)"
