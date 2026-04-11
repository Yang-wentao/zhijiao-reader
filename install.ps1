$ErrorActionPreference = "Stop"

$appDir = if ($env:APP_DIR) { $env:APP_DIR } else { Join-Path $HOME "zhijiao-reader" }
$repoUrl = if ($env:REPO_URL) { $env:REPO_URL } else { "https://github.com/YOUR_GITHUB_NAME/zhijiao-reader.git" }

if ($repoUrl -like "*YOUR_GITHUB_NAME*") {
  throw "Set REPO_URL to your published GitHub repository before using install.ps1. Example: `$env:REPO_URL='https://github.com/<owner>/zhijiao-reader.git'"
}

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
