#!/bin/bash
# 知交订阅 健康看门狗。由 launchd 每 30 分钟跑一次（com.zhijiao.watchdog）。
#
# 存在的理由：launchd 的 KeepAlive 只看"进程在不在"，而 2026-08-03 那次事故里
# 网关进程活得好好的、网站却躺了一整天——机器的临时端口被代理软件耗尽，谁也
# 连不上谁。所以这里判定"服务可达"用的是真实 HTTP 请求，不是进程状态。
#
# 每次运行都往 watchdog.log 追加一行，所以这个文件本身就是一份可用性记录。
#
# 用法（手动跑一次看看）：bash deploy/watchdog.sh

set -uo pipefail

LOG_DIR="$HOME/Library/Logs/zhijiao"
LOG_FILE="$LOG_DIR/watchdog.log"
LOCAL_URL="http://127.0.0.1:8787/v1/health"
PUBLIC_URL="https://api.zhijiao-reader.com/v1/health"

# macOS 的临时端口是 49152–65535，共 16384 个。TIME_WAIT 逼近这个数时，整台
# 机器将无法建立任何新连接（包括连自己），只有重启能清。
PORT_POOL=16384
TIME_WAIT_WARN=8000

mkdir -p "$LOG_DIR"

timestamp() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "$(timestamp) $*" >> "$LOG_FILE"; }

time_wait=$(netstat -an -f inet 2>/dev/null | grep -c TIME_WAIT || echo 0)

local_ok=no
curl -sf --max-time 5 "$LOCAL_URL" > /dev/null 2>&1 && local_ok=yes

public_ok=no
curl -sf --max-time 20 "$PUBLIC_URL" > /dev/null 2>&1 && public_ok=yes

actions=""

# 端口池告急：这是唯一一种看门狗修不了的故障，必须明确喊出来，否则表现出来
# 就是"服务莫名其妙全挂"。重启进程无济于事——要重启机器。
if [ "$time_wait" -ge "$TIME_WAIT_WARN" ]; then
  log "⚠️ 严重：TIME_WAIT=$time_wait（端口池共 $PORT_POOL）。临近耗尽后本机将无法建立任何连接。"
  log "   处理：找出制造大量连接的程序（常见是代理软件），退出它，然后重启 mac mini。"
  log "   排查命令：sudo lsof -nP -i -f inet | awk 'NR>1{print \$1}' | sort | uniq -c | sort -rn | head"
  actions="${actions}端口告警 "
fi

if [ "$local_ok" = "no" ]; then
  log "本机 8787 不可达 → 重启网关 com.zhijiao.cloud"
  sudo -n launchctl kickstart -k system/com.zhijiao.cloud 2>/dev/null \
    || launchctl kickstart -k system/com.zhijiao.cloud 2>/dev/null \
    || log "   重启失败：需要 root，请检查 com.zhijiao.watchdog 是否以 root 运行"
  actions="${actions}重启网关 "
  sleep 5
  curl -sf --max-time 5 "$LOCAL_URL" > /dev/null 2>&1 && log "   网关已恢复" || log "   网关仍未恢复"
elif [ "$public_ok" = "no" ]; then
  # 本机通、公网不通 → 问题在隧道那一跳（或上游网络）。
  log "本机正常但公网不可达 → 重启隧道 com.zhijiao.tunnel"
  sudo -n launchctl kickstart -k system/com.zhijiao.tunnel 2>/dev/null \
    || launchctl kickstart -k system/com.zhijiao.tunnel 2>/dev/null \
    || log "   重启失败：需要 root"
  actions="${actions}重启隧道 "
fi

status="正常"
[ "$local_ok" = "yes" ] || status="网关异常"
[ "$local_ok" = "yes" ] && [ "$public_ok" = "no" ] && status="公网异常"

log "巡检 状态=$status 本机=$local_ok 公网=$public_ok TIME_WAIT=$time_wait ${actions:+处理=$actions}"

# 日志超过 2000 行就砍掉前半，避免无限增长（每半小时一行，够记一个多月）。
if [ "$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 2000 ]; then
  tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
