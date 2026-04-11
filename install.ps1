$ErrorActionPreference = "Stop"

$appDir = if ($env:APP_DIR) { $env:APP_DIR } else { Join-Path $HOME "zhijiao-reader" }
$repoUrl = if ($env:REPO_URL) { $env:REPO_URL } else { "https://github.com/Yang-wentao/zhijiao-reader.git" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ is required. Install it from https://nodejs.org/en/download"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js 20+ first."
}

$nodeVersion = node -v
$nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 20) {
  throw "Node.js $nodeVersion is too old. Please upgrade to Node.js 20+."
}

if (Test-Path (Join-Path $appDir ".git")) {
  git -C $appDir pull --ff-only
} else {
  git clone $repoUrl $appDir
}

Set-Location $appDir
npm install
npm run launch
