#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/zhijiao-reader}"
REPO_URL="${REPO_URL:-https://github.com/Yang-wentao/zhijiao-reader.git}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required."
  echo "macOS: brew install node"
  echo "Windows: https://nodejs.org/en/download"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20+ first."
  exit 1
fi

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [[ "${NODE_MAJOR:-0}" -lt 20 ]]; then
  echo "Node.js $(node -v) is too old. Please upgrade to Node.js 20+."
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
