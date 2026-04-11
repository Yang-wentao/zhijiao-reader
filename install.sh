#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/codex-paper-reader}"
REPO_URL="${REPO_URL:-https://github.com/YOUR_GITHUB_NAME/codex-paper-reader.git}"

if [[ "$REPO_URL" == *"YOUR_GITHUB_NAME"* ]]; then
  echo "Set REPO_URL to your published GitHub repository before using install.sh."
  echo "Example: REPO_URL=https://github.com/<owner>/codex-paper-reader.git bash install.sh"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20+ first."
  exit 1
fi

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
npm install
npm run launch
