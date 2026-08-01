#!/bin/bash
# 更新知交云：拉最新代码 + 按需装依赖 + 重启网关服务（隧道不动）。
# 用法（mini 上，cloud/ 目录里）：bash deploy/update.sh
#
# 针对校园网优化：
#   - 拉取限速 15 秒无进展即中断（不再无限卡住）
#   - 官方源失败自动改走 gh-proxy 镜像
#   - package-lock 没变化就跳过 npm install
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLOUD_DIR=$(dirname "$SCRIPT_DIR")
MIRROR_URL="https://gh-proxy.com/https://github.com/Yang-wentao/zhijiao-reader.git"

# Abort a transfer that crawls below 1KB/s for 15s instead of hanging forever.
GIT_SLOW="-c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15"

cd "$CLOUD_DIR/.."
OLD_HEAD=$(git rev-parse HEAD)

echo "── 拉取最新代码 ──"
if git $GIT_SLOW pull --ff-only; then
  :
else
  echo "官方源失败，改走镜像 gh-proxy…"
  git $GIT_SLOW pull --ff-only "$MIRROR_URL" main
fi

cd "$CLOUD_DIR"
if git diff --quiet "$OLD_HEAD" HEAD -- cloud/package-lock.json 2>/dev/null; then
  echo "依赖无变化，跳过 npm install"
else
  npm install --omit=dev
fi

echo "── 重启网关服务（需要输入密码）──"
sudo launchctl kickstart -k system/com.zhijiao.cloud
sleep 2
curl -sf http://127.0.0.1:8787/v1/health && echo && echo "✅ 更新完成"
