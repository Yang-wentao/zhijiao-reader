#!/bin/bash
# 知交云 Mac mini 一键部署：把 cloudflared 隧道 + 网关服务装成 launchd 常驻
# 服务（开机自启、崩溃自动拉起、无需登录窗口）。
#
# 用法（在 mini 上，于仓库的 cloud/ 目录里）：
#   sudo bash deploy/setup-mini.sh
#
# 前置条件：
#   1. cloudflared 已登录且 ~/.cloudflared/config.yml 已配置（隧道可手动 run 成功）
#   2. cloud/.env 已填好 DEEPSEEK_API_KEY
#   3. cloud/ 里跑过 npm install
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 运行：sudo bash deploy/setup-mini.sh"
  exit 1
fi

RUN_USER="${SUDO_USER:-$(stat -f%Su /dev/console)}"
USER_HOME=$(dscl . -read "/Users/$RUN_USER" NFSHomeDirectory | awk '{print $2}')
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLOUD_DIR=$(dirname "$SCRIPT_DIR")
NODE_BIN=$(command -v node || echo /opt/homebrew/bin/node)
CLOUDFLARED_BIN=$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)
LOG_DIR="$USER_HOME/Library/Logs/zhijiao"
TUNNEL_CONFIG="$USER_HOME/.cloudflared/config.yml"

echo "运行用户: $RUN_USER"
echo "cloud 目录: $CLOUD_DIR"

[ -x "$NODE_BIN" ] || { echo "找不到 node（$NODE_BIN）"; exit 1; }
[ -x "$CLOUDFLARED_BIN" ] || { echo "找不到 cloudflared（$CLOUDFLARED_BIN）"; exit 1; }
[ -f "$TUNNEL_CONFIG" ] || { echo "找不到隧道配置 $TUNNEL_CONFIG"; exit 1; }
[ -f "$CLOUD_DIR/.env" ] || { echo "缺少 $CLOUD_DIR/.env（先 cp .env.example .env 并填 key）"; exit 1; }
[ -d "$CLOUD_DIR/node_modules" ] || { echo "缺少依赖，先在 cloud/ 里执行 npm install"; exit 1; }

mkdir -p "$LOG_DIR"
chown "$RUN_USER" "$LOG_DIR"

write_plist() {
  local label="$1" program_args="$2" workdir="$3" logfile="$4"
  cat > "/Library/LaunchDaemons/$label.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
$program_args
  </array>
  <key>UserName</key><string>$RUN_USER</string>
  <key>WorkingDirectory</key><string>$workdir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$logfile</string>
  <key>StandardErrorPath</key><string>$logfile</string>
</dict>
</plist>
PLIST
  chmod 644 "/Library/LaunchDaemons/$label.plist"
}

write_plist "com.zhijiao.tunnel" \
"    <string>$CLOUDFLARED_BIN</string>
    <string>--config</string>
    <string>$TUNNEL_CONFIG</string>
    <string>tunnel</string>
    <string>run</string>" \
  "$USER_HOME" "$LOG_DIR/tunnel.log"

write_plist "com.zhijiao.cloud" \
"    <string>$NODE_BIN</string>
    <string>server.mjs</string>" \
  "$CLOUD_DIR" "$LOG_DIR/cloud.log"

# 看门狗：定时任务而非常驻服务，所以用 StartInterval 而不是 KeepAlive；以 root
# 运行（需要 launchctl kickstart 系统域服务），并把 HOME 指回用户目录，好让脚本
# 把日志写进和其他服务同一个地方。
cat > /Library/LaunchDaemons/com.zhijiao.watchdog.plist << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.zhijiao.watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT_DIR/watchdog.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>HOME</key><string>$USER_HOME</string></dict>
  <key>WorkingDirectory</key><string>$CLOUD_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/watchdog-stderr.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/watchdog-stderr.log</string>
</dict>
</plist>
PLIST
chmod 644 /Library/LaunchDaemons/com.zhijiao.watchdog.plist

for label in com.zhijiao.tunnel com.zhijiao.cloud com.zhijiao.watchdog; do
  launchctl bootout "system/$label" 2>/dev/null || true
  launchctl bootstrap system "/Library/LaunchDaemons/$label.plist"
  echo "已启动 $label"
done

sleep 3
echo
echo "── 本机健康检查 ──"
if curl -sf http://127.0.0.1:8787/v1/health; then
  echo
  echo "✅ 网关服务运行中"
else
  echo "❌ 网关服务没有响应，查看日志：tail -50 $LOG_DIR/cloud.log"
  exit 1
fi
echo
echo "── 公网健康检查 ──"
if curl -sf https://api.zhijiao-reader.com/v1/health; then
  echo
  echo "✅ 公网可达，部署完成"
else
  echo "⚠️ 公网暂不可达（隧道可能还在建立，等 30 秒再试）："
  echo "   curl https://api.zhijiao-reader.com/v1/health"
  echo "   隧道日志：tail -50 $LOG_DIR/tunnel.log"
fi
echo
echo "── 看门狗 ──"
echo "每 30 分钟巡检一次并写日志：tail -20 $LOG_DIR/watchdog.log"
