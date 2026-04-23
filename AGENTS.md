# AGENTS.md

本文件给进入本仓库工作的 agent 使用。目标不是介绍产品，而是帮助 agent 快速建立正确的工程心智模型，知道：

- 这个项目是做什么的
- 代码应该从哪里读起
- 常见任务应该改哪些文件
- 哪些文件是本地私有配置，不能提交
- 修改后应该如何验证

---

## 1. 项目定位

**知交文献阅读**是一个本地优先的 AI 文献阅读工具。

核心交互形态：

- 左栏：PDF 阅读
- 右栏：针对当前选中文本生成翻译、术语解释、追问卡片

目标用户主要是中文学术阅读场景，尤其偏向：

- 英文论文阅读
- 含数学公式的文本翻译与问答
- 上海交通大学 API 使用场景
- 本地 Codex CLI / DeepSeek / OpenAI / OpenAI-compatible 接口切换

当前默认产品风格不是通用聊天应用，而是 **PDF 驱动的双栏阅读器**。

---

## 2. 技术栈

- 前端：React 19 + TypeScript + Vite
- 后端：Express 5 + TypeScript
- 桌面壳：Electron
- PDF：`@react-pdf-viewer/core` + `@react-pdf-viewer/search`
- Markdown / 数学公式：`react-markdown` + `remark-math` + `rehype-katex`
- AI SDK：`openai`
- 测试：Vitest + Testing Library

运行模式有两种：

1. **浏览器本地开发模式**
   - 前端 Vite dev server
   - 后端 Express dev server
2. **Electron 模式**
   - 开发态：加载本地 dev server
   - 打包态：Electron 内嵌编译后的前后端

---

## 3. 仓库结构

建议从下面这些路径读起：

### 核心入口

- `package.json`
  - 所有脚本入口都在这里
- `scripts/launch.mjs`
  - 一键启动、环境检查、自动创建 `.env`
- `server/index.ts`
  - 后端运行时入口，负责 provider 装配与路由挂载
- `src/App.tsx`
  - 前端主状态和页面主流程

### 前端

- `src/App.tsx`
  - 顶层状态、PDF tabs、卡片请求、连接设置弹窗
- `src/components/PdfPane.tsx`
  - 左栏 PDF 阅读、选区捕获、缩放、tab 文件打开
- `src/components/AssistantPanel.tsx`
  - 右栏整体布局
- `src/components/PassageCard.tsx`
  - 单张翻译 / 问答卡片
- `src/components/ConnectionSettingsModal.tsx`
  - provider 配置弹窗
- `src/state/cards.ts`
  - 卡片 reducer 和卡片状态机
- `src/lib/api.ts`
  - 前端调用后端 API 与 SSE 流式读取
- `src/lib/sse.ts`
  - SSE 解析
- `src/lib/streaming.ts`
  - 前端渐进显示辅助
- `src/types.ts`
  - 前端共享类型
- `src/styles.css`
  - 全局样式

### 后端

- `server/index.ts`
  - 组装 runtime state，创建 provider runtime map，启动 Express
- `server/routes/ai.ts`
  - `/api/config`、`/api/connection`、`/api/model`、`/api/translate/stream`、`/api/ask/stream`
- `server/runtimeConfig.ts`
  - 连接配置结构、默认值、保存加载、本地 Codex 可用性测试
- `server/prompts.ts`
  - OpenAI / DeepSeek / 兼容接口使用的系统 prompt
- `server/providers/*.ts`
  - 各 provider 适配层
- `server/providers/types.ts`
  - provider 接口定义

### 分发 / CI

- `.github/workflows/ci.yml`
  - push / PR 的测试与构建
- `.github/workflows/release.yml`
  - tag 触发 release
- `electron/main.mjs`
  - Electron 主进程入口
- `scripts/create-release.mjs`
  - 生成源码 zip
- `scripts/benchmark-models.mjs`
  - 用于比较模型首 token / 总耗时 / 公式表现

### 文档

- `README.md`
  - 中文主 README
- `README_en.md`
  - 英文备份 README
- `docs/github-distribution.md`
  - GitHub 分发说明
- `docs/electron-packaging.md`
  - Electron 打包说明

### 生成产物与本地输出

- `dist/`
  - 前端构建产物，不要手改
- `build/`
  - 后端构建产物，不要手改
- `release/`
  - 发布用 zip 与清单输出目录

除非任务明确要求处理打包产物，否则 agent 应优先修改源码，而不是修改 `build/` 或 `dist/`。

---

## 4. 运行链路

### 4.1 浏览器开发模式

最常用入口：

```bash
npm run launch
```

`scripts/launch.mjs` 会做几件事：

1. 如果没有 `.env`，从 `.env.example` 复制出一份
2. 读取 `.env`
3. 检查本地 Codex CLI 是否存在
4. 如果没有 `node_modules`，自动执行 `npm install`
5. 启动 `npm run dev`
6. 自动打开浏览器到 `http://localhost:5173`

`npm run dev` 又会并行启动：

- `npm run dev:server` -> `tsx watch server/index.ts`
- `npm run dev:client` -> `vite`

### 4.2 Electron 开发模式

```bash
npm run electron:dev
```

这会：

- 启动前后端 dev server
- 等待 `5173` 与 `8787` 就绪
- 打开 Electron 窗口

### 4.3 Electron 打包

```bash
npm run electron:pack
```

当前脚本会先构建前后端，再调用：

```bash
electron-builder --config electron-builder.json --publish never
```

`--publish never` 很重要。不要随便删掉，否则 Git tag 环境下 `electron-builder` 可能再次触发隐式发布并导致 GitHub Actions 失败。

---

## 5. 前端心智模型

前端真正的业务中心在 `src/App.tsx`。

### 5.1 顶层状态

`App.tsx` 维护这些核心状态：

- `config`
  - 来自 `/api/config`
- `connectionSettings`
  - 来自 `/api/connection`
- `tabs`
  - 每个 PDF 一个 tab
- `activeTabId`
  - 当前 PDF
- `ratio`
  - 左右栏宽度比例
- `toast`
  - 轻量提示

### 5.2 PDF -> 卡片的主流程

1. 用户在 `PdfPane` 选择 PDF
2. 用户在选区上 **右键** 触发 `contextmenu`
3. `PdfPane` 通过 `onContextSelection` 上报选区文本与起止页
4. `App.tsx` 弹出 `PdfContextMenu`，菜单提供三项：
   - 翻译
   - 加入笔记（原文）
   - 加入笔记（原文 + 译文）
5. 用户点「翻译」或「加入笔记（原文+译文）」时才创建 card 并调用 `streamTranslation()`
6. SSE 增量数据进入 `appendChunkWithCadence(...)`
7. `cardsReducer` 更新卡片状态
8. 「加入笔记」走 `POST /api/notes/append`，写入到 Obsidian vault 内的 markdown 文件

### 5.3 卡片状态机

卡片状态定义在 `src/types.ts`：

- `idle`
- `loading`
- `streaming`
- `done`
- `error`

状态更新逻辑集中在 `src/state/cards.ts`。

如果你要改：

- 流式展示节奏
- Retry 行为
- 卡片折叠/关闭
- 对话历史注入逻辑

先看 `cards.ts`，再看 `App.tsx`。

### 5.4 一个容易误判的点

仓库里存在 `src/components/SelectionToolbar.tsx`，但当前主流程**没有实际接入它**。当前模型是 **右键菜单驱动**：选区本身不会触发任何网络请求，必须通过 `PdfContextMenu` 选择「翻译」或「加入笔记」才会建卡或写笔记。

如果后续要恢复浮动工具栏或恢复“选中即翻译”：

- 需要改 `PdfPane.tsx` 的 `contextmenu` 监听以及 `App.tsx` 的 `handleContextSelection`
- 同时要检查测试 (`App.test.tsx`) 是否仍然假设“选中不翻译”

---

## 6. 后端心智模型

### 6.1 运行时状态

`server/index.ts` 里的 `RuntimeState` 是后端的核心。

它保存：

- 当前连接配置 `settings`
- 每个 provider 对应的 runtime 实例 `runtimes`
- 当前激活 provider `activeProviderName`
- 是否需要 setup `setupRequired`

### 6.2 provider runtime map

`createProviderRuntimeMap(settings)` 会根据配置生成五类 runtime：

- `codex`
- `deepseek`
- `sjtu`
- `openai`
- `custom`

每个 runtime 不只是 provider 实例，还带：

- `isReady`
- `model`
- `modelOptions`
- `canSwitchModels`
- `reasoningEffort`
- `setModel`
- `setReasoningEffort`

所以如果你要增加新 provider，不是只加一个 provider 类，还要同时更新：

1. `ProviderName` 类型
2. `ConnectionSettings`
3. `runtimeConfig.ts`
4. `server/index.ts` 的 runtime map
5. `src/types.ts`
6. `ConnectionSettingsModal.tsx`
7. `AssistantPanel.tsx` / `App.tsx`
8. 后端 `/api/config` 返回值

### 6.3 SSE 流式路由

AI 路由定义在 `server/routes/ai.ts`：

- `POST /api/translate/stream`
- `POST /api/ask/stream`

注意：

- SSE 每 10 秒有 heartbeat `status`
- 选中文本上限是 `8000` 字符
- `ask` 接口会带上当前卡片历史

如果你要排查“前端一直 thinking”或“45 秒超时”，首先检查：

1. provider 是否 ready
2. 路由是否返回 SSE
3. provider 是否真实流式
4. 前端 `readSseStream`
5. 前端超时控制

---

## 7. Provider 设计

所有 provider 都实现：

```ts
interface AIProvider {
  streamTranslation(input): Promise<AsyncIterable<string>>;
  streamAnswer(input): Promise<AsyncIterable<string>>;
}
```

### 7.1 DeepSeek / OpenAI / SJTU / Custom

这些 provider 都走 HTTP API。

大体模式：

- 构建 prompt
- 发起 OpenAI-compatible 请求
- 把响应转成 `AsyncIterable<string>`

### 7.2 Codex

`server/providers/codexProvider.ts` 不是 HTTP 调用，而是：

- 本地执行 `codex exec`
- 输出最后一条消息到临时文件
- 读回文本
- 以单 chunk 返回

这意味着：

- Local Codex **不是真流式**
- 前端现在的“渐进显示”是 UI 层模拟出来的

如果要提升 Local Codex 体验，要么：

- 想办法接入 CLI 的真正流式输出
- 要么继续优化前端 chunk cadence

### 7.3 Prompt 文件

有两套 prompt 逻辑：

- `server/prompts.ts`
  - 给 OpenAI-compatible provider 用
- `server/providers/codexPrompts.ts`
  - 给本地 Codex CLI 用

改 prompt 时，优先保证：

- 公式 delimiters 稳定
- “术语解释”单独成段
- 追问时不要串上下文

---

## 8. 连接配置与私有文件

### 8.1 配置来源

配置有两层：

1. `.env`
   - 默认值与本地启动相关
2. `config/providers.local.json`
   - 运行时连接配置，来自应用内 Settings 弹窗

默认文件路径逻辑在：

- `server/runtimeConfig.ts`

### 8.2 绝不能提交的文件

以下文件或目录已被 `.gitignore` 忽略，也**不应手动强行提交**：

- `.env`
- `config/providers.local.json`
- `node_modules`
- `dist`
- `build`
- `release/*.zip`
- `release/electron`
- `*.app`

本仓库里可能出现本地参考软件：

- `知云文献翻译.app`

这是参考素材，不是项目产物，不要围绕它做自动化依赖。

### 8.3 API key 处理原则

- 不要把真实 key 写进代码
- 不要把真实 key 写进 `.env.example`
- 不要把真实 key 写进 README
- 不要在测试里依赖真实 key

---

## 9. 测试与验证

### 9.1 常用验证命令

```bash
npm test
npm run build:server
npm run build
npm run electron:pack
```

### 9.2 什么时候跑什么

- 改前端交互：
  - `npm test`
  - `npm run build`
- 改后端 provider / runtime：
  - `npm test`
  - `npm run build:server`
- 改 Electron / release：
  - `npm run electron:pack`
- 改 README / docs：
  - 通常不需要跑全套测试，但至少检查 `git diff` 和排版

### 9.3 当前测试覆盖重点

仓库已有测试覆盖这些关键点：

- `App` 主流程
- `PdfPane`
- `PassageCard`
- `SplitLayout`
- `cardsReducer`
- SSE 解析
- API 调用
- `runtimeConfig`
- SJTU provider
- Codex prompt

如果改了上述核心模块，优先补对应测试，而不是只手动点一下页面。

### 9.4 最小手动冒烟路径

如果改动影响了真实使用流程，建议至少手动走一遍：

1. `npm run launch`
2. 打开应用
3. 进入 Settings，确认 provider 配置页能正常打开
4. 打开一个可选中文字的 PDF
5. 选中一段文本，确认右栏能创建翻译卡片
6. 如果涉及公式处理，确认 Markdown / KaTeX 渲染正常
7. 如果涉及 provider 配置，确认切换 provider 后 `/api/config` 返回的当前模型与 UI 一致

---

## 10. 常见任务应该改哪里

### A. 改右栏 UI 或卡片样式

看：

- `src/components/AssistantPanel.tsx`
- `src/components/PassageCard.tsx`
- `src/styles.css`

### B. 改 PDF 选区、缩放、tab

看：

- `src/components/PdfPane.tsx`
- `src/App.tsx`

### C. 改模型设置弹窗

看：

- `src/components/ConnectionSettingsModal.tsx`
- `src/types.ts`
- `server/runtimeConfig.ts`
- `server/index.ts`

### D. 新增 provider

看：

- `server/providers/types.ts`
- `server/providers/*.ts`
- `server/runtimeConfig.ts`
- `server/index.ts`
- `src/types.ts`
- `src/components/ConnectionSettingsModal.tsx`
- `src/App.tsx`

### E. 改翻译 / 追问 prompt

看：

- `server/prompts.ts`
- `server/providers/codexPrompts.ts`

### F. 改前端超时 / 流式行为

看：

- `src/lib/api.ts`
- `src/lib/sse.ts`
- `src/lib/streaming.ts`
- `src/App.tsx`

### G. 改 GitHub 发布和安装

看：

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `install.sh`
- `install.ps1`
- `scripts/create-release.mjs`
- `electron-builder.json`

---

## 11. 已知工程事实与坑点

这些不是 bug 列表，而是 agent 进入项目时必须知道的事实。

1. **Local Codex 不是 token 级真流式**
   - UI 上的流式感主要是前端渐进显示

2. **`SelectionToolbar.tsx` 当前未接入主流程**
   - 当前是「选区 → 右键菜单 → 翻译 / 加入笔记」模式
   - 选区本身不会触发任何后端请求，避免误选浪费 API 调用

3. **README 经常被直接编辑**
   - 推送前先 `git fetch`，避免因为远端 README 改动导致 push reject

4. **SJTU API 是一等公民**
   - 不要把它当成“顺手加的 custom provider”
   - 相关模型选项在 UI 和后端都已经单独维护

5. **README 以中文为主**
   - `README.md` 是 GitHub 默认展示页
   - `README_en.md` 只是英文备份，不要反过来维护

6. **Release workflow 对 `electron:pack` 很敏感**
   - 不要随便移除 `--publish never`

7. **`scripts/create-release.mjs` 不依赖项目构建**
   - 它是基于 git 状态打源码 zip

8. **PDF 主要面向可选中文字的文档**
   - 扫描版图像 PDF 当前不在 MVP 支持范围内

9. **不要手改构建产物目录**
   - `build/` 和 `dist/` 是结果，不是事实来源
   - 发布行为异常时，优先检查源码、脚本与 workflow，而不是直接修补构建输出

---

## 12. 修改建议

### 做任何中等以上修改前，建议的阅读顺序

1. `package.json`
2. `README.md`
3. `src/App.tsx`
4. `server/index.ts`
5. 对应模块文件

### 修改原则

- 尽量维持双栏阅读器而不是聊天应用的产品重心
- 涉及 provider 的改动，要同时检查前端类型、后端配置、UI 选项、测试
- 涉及流式改动，要同时检查前端 45 秒超时与后端 heartbeat
- 涉及 README / release 的改动，先 `git fetch` 再推
- 涉及 README 的改动，默认同步更新 `README_en.md` 或明确接受中英文暂时不一致
- 避免提交任何本地私密配置

---

## 13. 最小工作流建议

如果你是新进入仓库的 agent，推荐按下面顺序开始：

1. `git status -sb`
2. `cat package.json`
3. `sed -n '1,220p' src/App.tsx`
4. `sed -n '1,220p' server/index.ts`
5. 根据任务进入对应模块
6. 改完后至少跑：
   - `npm test`
   - `npm run build`
   - 必要时 `npm run build:server` / `npm run electron:pack`

---

## 14. 一句话总结

这是一个以 **PDF 选区 -> 翻译 / 追问卡片** 为核心流程的本地 AI 阅读器；真正的主干在 `src/App.tsx`、`server/index.ts`、`server/runtimeConfig.ts`、`server/routes/ai.ts`，而 provider、prompt、连接设置、分发脚本分别是它的四个关键边界。
