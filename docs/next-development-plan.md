# 知交文献阅读下一步开发流程

本文件描述当前项目下一阶段的推荐开发顺序。目标不是列出所有可能的想法，而是给出一条现实、可交付、可验证的路线。

---

## 总目标

把当前已经可用的浏览器版 / Electron 雏形，推进成一个：

- 以 DeepSeek / SJTU API 为主路径
- 跨平台可运行
- 可以发布为 macOS `dmg` 与 Windows `exe`
- 首次启动即可配置 API

的桌面应用。

---

## 产品判断

当前应明确接受以下产品取舍：

### 主路径

- DeepSeek 官方 API
- SJTU API
- OpenAI-compatible API

### 次路径

- Local Codex 保留兼容，但不再作为主要投入方向

### 原因

- DeepSeek / SJTU 更快
- 数学公式渲染更稳定
- 更适合做跨平台桌面分发
- Local Codex 依赖本地环境，维护成本高，用户体验不稳定

---

## Phase 1：稳定 API 主路径

### 目标

让用户在浏览器版和 Electron 开发版中，稳定使用：

- DeepSeek
- SJTU API
- OpenAI-compatible API

### 任务

1. 明确默认 provider 优先级
   - UI 默认优先展示 DeepSeek / SJTU
   - Local Codex 保留但弱化

2. 收紧 provider 文案
   - Settings 页面突出推荐 provider
   - 默认模型文案更明确

3. 优化超时与错误提示
   - 区分“连接失败”“超时”“模型不可用”“API key 缺失”

4. 验证公式渲染稳定性
   - 含行内公式
   - 含行间公式
   - 含英文术语解释段

### 验证

- DeepSeek 翻译与追问都能正常返回
- SJTU API 翻译与追问都能正常返回
- Settings 切换 provider 后 UI 与后端状态一致

---

## Phase 2：完成 Electron 运行时配置迁移

### 目标

让桌面版真正具备“可安装后使用”的配置持久化能力。

### 当前问题

当前配置默认落在：

- `config/providers.local.json`

其路径依赖 `process.cwd()`，这对开发态可用，但对安装包不稳。

### 任务

1. 为 Electron 生产态定义用户配置目录
   - macOS：`~/Library/Application Support/...`
   - Windows：`%AppData%/...`

2. 把连接配置读写迁移到用户目录

3. 保持开发态与打包态都能工作
   - 开发态仍可读项目内本地配置
   - 打包态使用用户目录配置

4. 补配置文件迁移逻辑
   - 如果旧配置存在，可提示或自动迁移

### 验证

- 打包后的程序首次启动可保存设置
- 重启应用后设置仍保留
- 不需要手动修改项目目录下文件

---

## Phase 3：从工程打包转向发布打包

### 目标

把当前 Electron 打包产物从工程用 `zip` 提升为用户可下载的桌面安装包。

### 当前状态

当前 `electron-builder.json` 目标是：

- mac：`zip`
- win：`zip`
- linux：`AppImage`

### 目标状态

- mac：`dmg` + `zip`
- win：`nsis` + `zip`
- linux：`AppImage`

### 任务

1. 更新 `electron-builder.json`
2. 补充平台图标资源
   - `.icns`
   - `.ico`
3. 统一应用元数据
   - 名称
   - 版本
   - 描述
   - appId
4. 校验产物命名
   - GitHub Releases 中一眼能区分平台

### 验证

- mac 上生成 `dmg`
- Windows runner 上生成 `exe`
- Linux runner 上生成 `AppImage`

---

## Phase 4：完善 GitHub 发布流程

### 目标

做到“打 tag -> 自动出安装包”。

### 任务

1. 继续完善 `.github/workflows/release.yml`
2. 让不同平台 runner 各自产出合适格式
3. 上传到 GitHub Releases
4. 校验 release 页面展示是否清晰

### 验证

- tag 推送后产物自动上传
- README 中下载说明与 release 页面一致

---

## Phase 5：面向普通用户的发布质量

### 目标

让不是开发者的同学也能正常下载和使用。

### 任务

1. 首次启动引导
   - 打开 Settings
   - 选择 provider
   - 输入 API key
   - 测试连接

2. 更友好的错误提示
   - API key 缺失
   - 模型名错误
   - 网络错误
   - 超时

3. README 与应用内说明统一

4. 后续再考虑签名
   - mac 签名与 notarization
   - windows 签名

### 注意

签名不是当前 MVP 阶段的前置条件。它影响的是“下载后打开是否丝滑”，不是“能否开发和打包”。

---

## 推荐实际执行顺序

按优先级，建议严格按下面顺序推进：

1. 稳定 DeepSeek / SJTU API 主路径
2. 迁移 Electron 配置文件到用户目录
3. 把 `zip` 改成 `dmg` / `exe`
4. 稳定 GitHub Releases 自动产物
5. 再考虑签名、图标、安装体验优化

---

## 现在不必优先做的事

以下事项可以明确延后：

- 深度优化 Local Codex
- OCR / 扫描 PDF 支持
- 自动更新
- 大规模重构前后端架构

---

## 最小交付定义

当满足以下条件时，可以认为桌面版进入“可对外测试”阶段：

- DeepSeek 与 SJTU API 可以在桌面版中正常使用
- 设置可以保存并持久化
- mac 可下载 `dmg`
- Windows 可下载 `exe`
- README 能指导用户完成下载与 API 配置
