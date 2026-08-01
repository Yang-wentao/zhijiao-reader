#!/bin/bash
# 更新知交云：拉最新代码 + 装依赖 + 重启网关服务（隧道不动）。
# 用法（mini 上，cloud/ 目录里）：bash deploy/update.sh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLOUD_DIR=$(dirname "$SCRIPT_DIR")

cd "$CLOUD_DIR/.."
git pull --ff-only
cd "$CLOUD_DIR"
npm install --omit=dev

echo "重启网关服务（需要输入密码）…"
sudo launchctl kickstart -k system/com.zhijiao.cloud
sleep 2
curl -sf http://127.0.0.1:8787/v1/health && echo && echo "✅ 更新完成"
