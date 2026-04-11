$ErrorActionPreference = "Stop"

$appDir = if ($env:APP_DIR) { $env:APP_DIR } else { Join-Path $HOME "codex-paper-reader" }
$repoUrl = if ($env:REPO_URL) { $env:REPO_URL } else { "https://github.com/YOUR_GITHUB_NAME/codex-paper-reader.git" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js 20+ first."
}

if (Test-Path (Join-Path $appDir ".git")) {
  git -C $appDir pull --ff-only
} else {
  git clone $repoUrl $appDir
}

Set-Location $appDir
npm install
npm run launch
