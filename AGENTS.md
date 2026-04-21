# AGENTS.md

本文件面向进入本仓库工作的 agent。目的不是介绍产品，而是提供一份足够完整的接手说明，帮助 agent 在最短时间内判断：

- 项目到底在做什么
- 当前产品重心和非目标是什么
- 前后端、Electron、发布脚本分别在哪里
- 本地私有配置和敏感文件在哪里，哪些不能提交
- 下一阶段开发该优先做什么
- 修改后至少应如何验证

---

## 1. 项目概览

**知交文献阅读 / ZhiJiao Reader** 是一个本地优先、面向中文学术阅读场景的 AI 文献阅读工具。

核心体验是双栏阅读器：

- 左栏：PDF 阅读、选区、缩放、多文档 tab
- 右栏：对选中段落生成翻译、术语解释、追问卡片

当前项目重点已经从 “本地 Codex 驱动” 转向 “远程 API 驱动”，更具体地说：

- 优先支持：`DeepSeek`、`SJTU API`、`OpenAI-compatible` API
- 次要支持：`Local Codex`

原因很直接：

- DeepSeek / SJTU 响应更快
- 数学公式渲染质量更稳定
- 桌面化与跨平台发布成本更低

### 当前主产品判断

如果 agent 需要在多个方向之间取舍，默认优先级如下：

1. 保证 PDF 阅读 + 翻译卡片主流程稳定
2. 保证 DeepSeek / SJTU API 使用体验
3. 保证公式渲染与流式输出
4. 推进 Electron 桌面化
5. Local Codex 仅保留兼容性，不应再作为主路径优化重点

### 非目标

以下内容当前不应成为默认开发重点：

- 把产品做成通用聊天应用
- 深度投入 Local Codex 体验优化
- 支持 OCR 扫描版 PDF 作为主能力
- 在没有必要的前提下大规模重构前后端架构

---

## 2. 技术栈

- 前端：React 19 + TypeScript + Vite
- 后端：Express 5 + TypeScript
- 桌面壳：Electron
- PDF：`@react-pdf-viewer/core` + `@react-pdf-viewer/search`
- Markdown / 公式：`react-markdown` + `remark-math` + `rehype-katex`
- AI SDK：`openai`
- 测试：Vitest + Testing Library
- 打包：`electron-builder`

运行模式有两类：

1. **浏览器开发模式**
   - Vite 前端 dev server
   - Express 后端 dev server
2. **Electron 模式**
   - 开发态：Electron 加载本地 dev server
   - 打包态：Electron 启动内嵌后端并加载打包后的前端

---

## 3. 目录与组成要素

### 核心入口

- `package.json`
  - 所有脚本入口
- `scripts/launch.mjs`
  - 本地一键启动、环境检查、自动创建 `.env`
- `server/index.ts`
  - 后端入口，负责 runtime 组装与路由挂载
- `src/App.tsx`
  - 前端主流程入口
- `electron/main.mjs`
  - Electron 主进程入口

### 前端

- `src/App.tsx`
  - 顶层状态、PDF tab、卡片流、设置弹窗、左右布局
- `src/components/PdfPane.tsx`
  - 左侧 PDF 阅读、缩放、选区捕获、文件切换
- `src/components/AssistantPanel.tsx`
  - 右侧整体面板
- `src/components/PassageCard.tsx`
  - 翻译 / 问答卡片
- `src/components/ConnectionSettingsModal.tsx`
  - provider 设置页
- `src/components/SelectionToolbar.tsx`
  - 存在但当前未接入主流程
- `src/state/cards.ts`
  - 卡片 reducer / 状态机
- `src/lib/api.ts`
  - 前端到后端 API 调用与 SSE 读取
- `src/lib/sse.ts`
  - SSE 解析
- `src/lib/streaming.ts`
  - 前端渐进输出节奏控制
- `src/types.ts`
  - 共享类型
- `src/styles.css`
  - 样式

### 后端

- `server/index.ts`
  - 创建 provider runtime map，启动 server
- `server/routes/ai.ts`
  - 配置、连接测试、模型切换、翻译流、问答流
- `server/runtimeConfig.ts`
  - provider 配置定义、落盘、读取、连接测试
- `server/prompts.ts`
  - 远程 API prompt
- `server/providers/codexPrompts.ts`
  - Local Codex 专用 prompt
- `server/providers/*.ts`
  - provider 适配实现
- `server/providers/types.ts`
  - provider 抽象接口

### Electron / 分发 / CI

- `electron/main.mjs`
  - Electron 窗口与内嵌 server 启动逻辑
- `electron/preload.mjs`
  - Electron preload
- `electron-builder.json`
  - 打包目标配置
- `.github/workflows/ci.yml`
  - 测试与构建
- `.github/workflows/release.yml`
  - tag 触发 release
- `scripts/create-release.mjs`
  - 生成源码 zip
- `scripts/benchmark-models.mjs`
  - 模型速度 / 效果对比脚本

### 文档

- `README.md`
  - 中文主 README，GitHub 默认展示页
- `README_en.md`
  - 英文备份 README
- `docs/github-distribution.md`
  - GitHub 分发说明
- `docs/electron-packaging.md`
  - Electron 当前打包说明
- `docs/next-development-plan.md`
  - 下一步开发流程
- `docs/local-sensitive-files.md`
  - 本地敏感文件说明

### 生成产物

- `dist/`
  - 前端打包产物，不要手改
- `build/`
  - 后端打包产物，不要手改
- `release/`
  - 发布物输出

除非任务就是在检查构建结果，否则 agent 不应直接修改 `dist/` 或 `build/`。

---

## 4. 产品主流程

### 4.1 浏览器开发模式

最常用入口：

```bash
npm run launch
```

该命令会：

1. 自动检查 / 创建 `.env`
2. 检查本地运行环境
3. 启动前后端
4. 打开浏览器

开发态也可以直接用：

```bash
npm run dev
```

### 4.2 Electron 开发模式

```bash
npm run electron:dev
```

用途：

- 验证桌面壳是否正常
- 验证内嵌流程是否与浏览器版一致

### 4.3 打包模式

```bash
npm run electron:pack
```

当前会构建：

- 前端 `dist/`
- 后端 `build/server/`
- Electron 包

当前打包配置仍偏工程态，不是最终用户友好的安装器配置。

---

## 5. 前端心智模型

真正的业务中心在 `src/App.tsx`。

### 顶层状态

主要维护：

- 当前配置 `config`
- 当前连接设置 `connectionSettings`
- PDF tabs `tabs`
- 当前激活 tab `activeTabId`
- 左右分栏比例 `ratio`
- toast / 短提示

### PDF -> 翻译卡片主链路

1. 用户在 `PdfPane` 中选中一段 PDF 文本
2. `PdfPane` 把选区文本回传给 `App.tsx`
3. `handleSelectionCaptured()` 检查长度限制
4. 当前默认行为：**直接进入翻译**
5. 创建新 card
6. 调用 `streamTranslation()`
7. SSE chunk 进入前端并渐进展示
8. `cardsReducer` 维护卡片状态

### 当前一个重要事实

仓库存在 `src/components/SelectionToolbar.tsx`，但**没有接入当前主流程**。

所以不要误以为当前产品行为是：

- 选中后出现 “Translate / Ask”

实际上是：

- 选中后直接翻译

如果后续要恢复浮动工具栏，需要同步修改：

- `src/App.tsx`
- 相关测试

---

## 6. 后端心智模型

### 运行时状态

后端核心在 `server/index.ts` 中的 runtime state。

它主要维护：

- 当前连接设置
- 各 provider runtime
- 当前激活 provider
- 是否需要 setup

### provider runtime map

当前支持的 provider 名称：

- `codex`
- `deepseek`
- `sjtu`
- `openai`
- `custom`

每个 runtime 不只是一个 provider 实例，还会暴露：

- `isReady`
- `model`
- `modelOptions`
- `canSwitchModels`
- `reasoningEffort`
- `setModel`
- `setReasoningEffort`

### SSE 路由

AI 主路由在 `server/routes/ai.ts`：

- `POST /api/translate/stream`
- `POST /api/ask/stream`

关键事实：

- 前端依赖 SSE
- 后端有 heartbeat
- 选中文本存在长度上限
- `ask` 会带卡片上下文

如果出现 “一直 thinking / 长时间卡住 / 超时”，优先检查：

1. provider 是否 ready
2. 路由是否返回正确 SSE
3. provider 是否真流式
4. 前端 timeout 设置
5. 网络请求是否被阻断

---

## 7. Provider 取舍

### 当前产品判断

默认推荐顺序：

1. `sjtu`
2. `deepseek`
3. `openai`
4. `custom`
5. `codex`

### 原因

- `DeepSeek` / `SJTU API`
  - 响应快
  - 数学公式处理更稳定
  - 更适合作为发布版主路径
- `Local Codex`
  - 不是 token 级真流式
  - 需要本地 CLI 环境
  - 在跨平台桌面化时维护成本更高

### 工程决策

后续如果需要在资源有限时取舍，应优先优化：

- DeepSeek / SJTU API 连接体验
- 模型选择与测试连接
- 公式渲染质量
- 打包后配置持久化

而不是继续深挖 Local Codex UI 体验。

---

## 8. 敏感文件与本地私有配置

当前最明确的本地敏感文件：

- `.env`
- `config/providers.local.json`

这些文件可能包含：

- DeepSeek API key
- SJTU API key
- OpenAI API key
- 自定义 provider key / base URL

### 规则

- 不要提交真实 API key
- 不要把真实 key 写入 README
- 不要把真实 key 写入 `.env.example`
- 不要把这些文件移动到会被误提交的位置

更多细节见：

- `docs/local-sensitive-files.md`

---

## 9. 当前已知非项目文件

工作区当前存在与知交项目无关的额外文件，已经建议单独整理：

- `IPQuality/`
- `IPQuality-windows-test/`
- `IPQuality-windows-test.zip`

这类文件不应混入知交项目提交。后续如果还出现类似额外项目材料，优先移动到单独目录，而不是留在仓库根目录。

---

## 10. 下一步开发方向

后续开发默认遵循下面的技术路线：

### Phase 1

产品主路径彻底转向：

- DeepSeek 官方 API
- SJTU API
- OpenAI-compatible API

### Phase 2

把 Electron 桌面化做完整，优先解决：

- 配置文件从 `process.cwd()` 迁移到用户目录
- 打包态读写配置稳定
- 首次启动配置流程

### Phase 3

把当前工程型打包改成真正发布格式：

- mac: `dmg`
- win: `exe` / `nsis`
- linux: `AppImage`

### Phase 4

补发布质量：

- 图标
- 安装包元数据
- GitHub Releases 自动产物
- 签名 / notarization

完整任务拆解见：

- `docs/next-development-plan.md`

---

## 11. 常用修改入口

### 改右栏 UI / 卡片样式

- `src/components/AssistantPanel.tsx`
- `src/components/PassageCard.tsx`
- `src/styles.css`

### 改 PDF 选区 / 缩放 / tab

- `src/components/PdfPane.tsx`
- `src/App.tsx`

### 改 provider 设置页

- `src/components/ConnectionSettingsModal.tsx`
- `src/types.ts`
- `server/runtimeConfig.ts`
- `server/index.ts`

### 新增或修改 provider

- `server/providers/*.ts`
- `server/providers/types.ts`
- `server/runtimeConfig.ts`
- `src/types.ts`
- `src/components/ConnectionSettingsModal.tsx`

### 改 prompt

- `server/prompts.ts`
- `server/providers/codexPrompts.ts`

### 改 Electron 打包

- `electron/main.mjs`
- `electron-builder.json`
- `.github/workflows/release.yml`

---

## 12. 验证建议

### 常用命令

```bash
npm test
npm run build
npm run build:server
npm run electron:pack
```

### 最小手动冒烟路径

如果改动影响真实用户流程，至少验证：

1. 启动应用
2. 打开 Settings
3. 切换到 DeepSeek 或 SJTU API
4. 测试连接成功
5. 打开一个可选中文字的 PDF
6. 选中一段文字
7. 右栏出现翻译卡片
8. 如果段落含公式，确认 KaTeX 渲染正常

---

## 13. Agent 工作准则

如果是新进入仓库的 agent，建议先做：

1. `git status -sb`
2. 阅读 `README.md`
3. 阅读本文件 `AGENTS.md`
4. 阅读 `src/App.tsx`
5. 阅读 `server/index.ts`
6. 再根据任务进入具体模块

### 默认原则

- 优先改源码，不改生成产物
- 优先保护 API key，不泄露敏感信息
- 优先维持双栏阅读器产品形态
- 优先保障 DeepSeek / SJTU API 主路径
- 非必要不围绕 Local Codex 深挖体验

---

## 14. 一句话总结

这是一个以 **PDF 选区 -> 翻译 / 术语解释 / 追问卡片** 为核心流程的本地 AI 文献阅读器；当前最现实的产品路径是 **DeepSeek / SJTU API 驱动的跨平台 Electron 桌面版**，而不是继续把 Local Codex 作为主能力打磨。
