# 落地页部署（zhijiao-reader.com）

`site/` 是产品介绍与下载页：纯静态、无构建、无依赖。它由 `cloud/` 网关的同一个进程提供服务，所以根域名和 API 共用一条隧道、一次部署。

```
zhijiao-reader.com/          → site/index.html（介绍 + 下载）
zhijiao-reader.com/app/      → site/app/（网页版，见下）
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

## 网页版（site/app/）

`site/app/` 是**同一个 React 应用的浏览器构建**（`npm run build:web`，构建产物直接提交进仓库，mini 上零构建）。它直连同源的 `/v1/*`，所以不需要 CORS；只支持知交订阅（订阅码存浏览器 localStorage），划线批注仅会话内有效、不写回 PDF，Obsidian 笔记不可用。

改动前端后要更新网页版：

```bash
npm run build:web        # 重新生成 site/app/
git add site/app && git commit && git push
# 然后 mini 上照常 bash deploy/update.sh
```

本地调试：`npm run dev:web`（Vite 把 /v1 代理到生产网关），打开 http://localhost:5173/app/ 。
注意 `vite.config.ts` 里 web 模式的 base 是 `/app/`、outDir 是 `site/app`——`emptyOutDir` 会先清空该目录，不要往里面手放文件。

## 下载链接的走向

落地页上**不出现任何第三方地址**：下载按钮指向自己域名下的 `/download/mac-arm64`、`/download/mac-x64`、`/download/win-x64`，由网关 302 跳到实际的安装包。映射表在 `cloud/server.mjs` 顶部的 `DOWNLOADS`，只有那里知道文件真正放在哪。

（跳转的落点仍然是 GitHub Releases —— 安装包上百 MB，不适合放进仓库或压在校园网的上行带宽上。页面本身已经没有任何开源/GitHub 字样，但用户点下去后浏览器地址栏会看到。要彻底隐藏就得自己托管文件，届时只需改 `DOWNLOADS` 一处。）

## 发新版本后要改的地方

发版 = 推一个 `v*` tag，CI 自动构建并发布安装包（文件名带版本号）。之后要同步三处版本号：

1. `package.json` 的 `version`
2. `cloud/server.mjs` 的 `RELEASE_VERSION`（下载跳转的文件名）
3. `site/index.html` 里「当前版本 vX.Y.Z」那行

改完 `npm run build:web` 重新生成 `site/app/`，提交后在 mini 上 `bash deploy/update.sh`。
