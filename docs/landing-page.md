# 落地页部署（zhijiao-reader.com）

`site/` 是产品介绍与下载页：纯静态、无构建、无依赖。它由 `cloud/` 网关的同一个进程提供服务，所以根域名和 API 共用一条隧道、一次部署。

```
zhijiao-reader.com/          → site/index.html（介绍 + 下载）
api.zhijiao-reader.com/v1/*  → 订阅 API
api.zhijiao-reader.com/admin → 管理台
```

## 首次部署（在 Mac mini 上，只需做一次）

隧道目前只路由 `api.zhijiao-reader.com`，需要把根域名也指过来。

**1. 更新代码并重启网关**

```bash
cd ~/zhijiao-reader/cloud
bash deploy/update.sh
```

**2. 给隧道加根域名规则**

编辑 `~/.cloudflared/config.yml`，在 ingress 列表里、`http_status:404` 兜底规则**之前**插入两条：

```yaml
ingress:
  - hostname: api.zhijiao-reader.com
    service: http://127.0.0.1:8787
  - hostname: zhijiao-reader.com          # ← 新增
    service: http://127.0.0.1:8787
  - hostname: www.zhijiao-reader.com      # ← 新增
    service: http://127.0.0.1:8787
  - service: http_status:404
```

**3. 建 DNS 记录并重启隧道**

```bash
cloudflared tunnel route dns zhijiao zhijiao-reader.com
cloudflared tunnel route dns zhijiao www.zhijiao-reader.com
sudo launchctl kickstart -k system/com.zhijiao.tunnel
```

**4. 验证**

```bash
curl -sI https://zhijiao-reader.com | head -1     # 期望 HTTP/2 200
```

浏览器打开 <https://zhijiao-reader.com> 应看到介绍页。

## 日常更新

改完 `site/` 里的内容后推送，然后在 mini 上：

```bash
cd ~/zhijiao-reader/cloud && bash deploy/update.sh
```

静态文件由 Express 直接读盘，重启网关即生效，无需构建。

## 发新版本后要改的地方

`site/index.html` 里下载链接用的是 `releases/latest/download/<文件名>`，**跳转永远指向最新 release**，但文件名带版本号，所以发版后需要更新三处文件名与页面上的「当前版本 vX.Y.Z」字样。搜索 `1.1.1` 即可全部找到。
