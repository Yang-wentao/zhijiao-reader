# 知交订阅（zhijiao-cloud）

给「知交文献阅读」订阅用户使用的 API 网关：**激活码鉴权 → 每月额度检查 → 转发 DeepSeek → 用量入账**。跑在自己的机器上（当前：Mac mini + Cloudflare Tunnel），API key 只存在服务器端，客户端里没有任何秘密。

- 技术形态：零构建、近零依赖（Express + Node 内置 `node:sqlite` / `fetch`），`node server.mjs` 直接跑
- SSE 事件协议与桌面端 `/api/*/stream` 完全一致（status / delta / done / error）
- 客户端断开立即中止上游请求，不为看不到的输出付费
- Prompt 与桌面端 `server/prompts.ts` 保持同步（见 `prompts.mjs` 头部的 SYNC NOTE）

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/health` | 健康检查（无需鉴权） |
| GET | `/v1/me` | 查询本码额度与用量 |
| POST | `/v1/translate/stream` | 翻译（SSE），`{selectionText, pageNumber}` |
| POST | `/v1/ask/stream` | 追问（SSE），`{selectionText, pageNumber, question, history}` |

鉴权：`Authorization: Bearer ZJ-XXXX-XXXX-XXXX`。错误码：401 无效码 / 402 额度用完 / 400 参数问题。

## 首次部署（Mac mini）

前置：cloudflared 已登录、`~/.cloudflared/config.yml` 指向本机 8787（见仓库根 README 的隧道章节）。

```bash
git clone https://github.com/Yang-wentao/zhijiao-reader.git ~/zhijiao-reader
cd ~/zhijiao-reader/cloud
npm install
cp .env.example .env
nano .env                    # 填 DEEPSEEK_API_KEY
node --test                  # 跑测试（可选但建议）
sudo bash deploy/setup-mini.sh
```

脚本会把隧道和网关装成两个 launchd 常驻服务（`com.zhijiao.tunnel` / `com.zhijiao.cloud`），开机自启、崩溃自动拉起，并做本机 + 公网双重健康检查。

## 日常运维

```bash
cd ~/zhijiao-reader/cloud

# 发一个激活码（默认每月 300 万 tokens）
node admin.mjs create --label 张三 --quota 3000000

# 看所有码和用量
node admin.mjs list

# 某个码的明细 / 停用 / 恢复 / 调额度
node admin.mjs usage   ZJ-XXXX-XXXX-XXXX
node admin.mjs disable ZJ-XXXX-XXXX-XXXX
node admin.mjs enable  ZJ-XXXX-XXXX-XXXX
node admin.mjs quota   ZJ-XXXX-XXXX-XXXX 5000000

# 更新部署（拉代码 + 重启网关）
bash deploy/update.sh

# 看日志
tail -f ~/Library/Logs/zhijiao/cloud.log
tail -f ~/Library/Logs/zhijiao/tunnel.log

# 手动重启 / 停止
sudo launchctl kickstart -k system/com.zhijiao.cloud
sudo launchctl bootout system/com.zhijiao.cloud
```

数据库在 `cloud/data/zhijiao-cloud.db`（SQLite 单文件，备份 = 拷走这个文件）。`.env` 与 `data/` 均已被 git 忽略。

## 卸载

```bash
sudo launchctl bootout system/com.zhijiao.tunnel
sudo launchctl bootout system/com.zhijiao.cloud
sudo rm /Library/LaunchDaemons/com.zhijiao.{tunnel,cloud}.plist
```
