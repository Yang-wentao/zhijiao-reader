#!/bin/bash
# 更新知交云：拉最新代码 + 按需装依赖 + 重启网关服务（隧道不动）。
# 用法（mini 上，cloud/ 目录里）：bash deploy/update.sh
#
# 针对校园网优化：
#   - 每次拉取有硬性总时限，卡在握手阶段也会被掐断
#   - 显示进度，不会安静地假死
#   - 官方源失败自动改走 gh-proxy 镜像
#   - package-lock 没变化就跳过 npm install
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLOUD_DIR=$(dirname "$SCRIPT_DIR")
MIRROR_URL="https://gh-proxy.com/https://github.com/Yang-wentao/zhijiao-reader.git"
PULL_TIMEOUT=90

# 低速中断只作用于「已经开始的传输」；HTTP/1.1 是因为校园网对 HTTP/2 会报
# framing layer 错误。
GIT_SLOW="-c http.version=HTTP/1.1 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20"

# macOS 没有 coreutils 的 timeout，所以自己来：后台跑，超时就杀掉。没有这层
# 保护时，卡在 TLS 握手的 git 会一直静默挂着——低速中断根本轮不到触发。
run_with_timeout() {
  local seconds="$1"; shift
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$seconds" ]; then
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      echo "（超过 ${seconds} 秒无果，已中断）"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

cd "$CLOUD_DIR/.."
OLD_HEAD=$(git rev-parse HEAD)

echo "── 拉取最新代码 ──"
if run_with_timeout "$PULL_TIMEOUT" git $GIT_SLOW pull --progress --ff-only; then
  :
else
  echo "官方源不通，改走镜像 gh-proxy…"
  run_with_timeout "$PULL_TIMEOUT" git $GIT_SLOW pull --progress --ff-only "$MIRROR_URL" main
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
