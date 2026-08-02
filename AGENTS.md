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

`createProviderRuntimeMap(settings)` 会根据配置生成六类 runtime：

- `cloud`（知交云 —— 订阅版网关，见下方 7.4）
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

### 7.4 知交云（cloud）

`server/providers/cloudProvider.ts` 是唯一**不直接调用模型 API** 的 provider：

- 它把请求转发到 `cloud/` 目录里的网关（部署在开发者自己的机器上），带上激活码
- 网关负责鉴权、额度检查、用真实 API key 调模型，再把 SSE 流回传
- 客户端这边没有 API key、没有模型选择、不构建 prompt——这些都归网关
- `/api/cloud/balance` 代理查询激活码额度，供顶栏 chip 显示

改动知交云相关逻辑时，注意 `cloud/prompts.mjs` 是 `server/prompts.ts` 的刻意副本，两边都有 SYNC NOTE，改 prompt 要同步。

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

---

## 15. v0.3.4 之后的关键架构变化（必读）

> **这一节是给 v0.3.4 之后接手仓库的 agent 看的。**前面 1-14 节描述的是稳定的工程基线，但其中部分细节在 v0.3.3 / v0.3.4 这一轮迭代里已经发生变化。本节集中说明：(a) 新增的架构决策、(b) 容易踩的坑、(c) 对前面章节的勘误。

### 15.1 PDF 多 tab 持久化架构（最重要）

**v0.3.2 之前**：`PdfPane` 只渲染一个 `<Viewer>`，绑定到当前 active tab 的 `fileUrl`。切换 tab 就是切 fileUrl → Viewer 重挂载 → PDF 重新加载 → 体验上有 500-600ms 的白屏。

**v0.3.4 现在**：`PdfPane` 同时持有**所有**打开 tab 的 Viewer 实例，每个 tab 各自一份 `<PdfTabViewer>` 子组件，**永远不卸载**，只用 CSS 切换可见性。这是切换无缝的根本。

关键文件：[src/components/PdfPane.tsx](src/components/PdfPane.tsx)。

**几个绝对不能踩的实现细节：**

1. **`visibility: hidden` + `position: absolute; inset: 0`，不是 `display: none`。**

   为什么？react-pdf-viewer 内部的 IntersectionObserver 决定每页 canvas 是否保留在渲染队列。`display: none` 让元素尺寸 0×0 → IO 报告"不可见" → 渲染队列把那个 tab 的 canvas 全清掉。切回来时 PDF.js 要重画所有可见页 → 0.5s 白屏。

   `visibility: hidden` 的元素**仍在 layout**，IO 仍然认为它"相交于 viewport"，canvas 全程保留。所以切换是纯粹的 z-index 翻转。

   父容器 `.pdf-viewer-area` 必须 `position: relative; overflow: hidden`，让绝对定位的子元素正确锚定。**不要随意改这两个 CSS 属性**。

2. **`searchPlugin()` 必须在组件顶层调用、且全局只调一次。**

   `searchPlugin()` 内部用了 React Hooks（useMemo、useState 等）。如果你在 `useMemo` / `useEffect` 里调用、或在"懒创建 Map"里按 tabId 创建多份 plugin 实例，hook 数量会在 React 渲染之间变化 → 抛 `Rendered more hooks than during the previous render` → **整个组件树崩溃 → 白屏**。

   `PdfPane` 现在用**单个**共享 plugin 给所有 Viewer 用（同时只有一个 Viewer 可见，不会互相打架）。**不要试图给每个 tab 一个独立 plugin。**

3. **切换瞬间需要持续 500ms 的 RAF 循环重写 scrollTop。**

   react-pdf-viewer 在 IntersectionObserver 上报 `visible=true` 之后 ~150ms 会跑某段内部代码（推测是 `virtualizer.scrollToItem` 之类），**强制把 scrollTop 改成 0**。如果只在激活瞬间写一次 scrollTop，会被这段内部代码覆盖。

   现在的方案：激活时进入"restore 窗口"，每帧 `requestAnimationFrame` 重写 scrollTop 到 `initialScrollTop`，持续 500ms。期间所有 scroll 事件被 `isRestoringRef` 闸门跳过保存（避免内部程序化滚动污染 lastScrollTop）。

4. **scroll listener 加了双闸门：`isActiveRef` + `isRestoringRef`。**

   - `isActiveRef`：tab 隐藏时所有 scroll 事件不存盘（确保只有用户真实交互的滚动会保存）
   - `isRestoringRef`：激活后 500ms restore 窗口期内不存盘

### 15.2 PDF tab 状态结构（新字段）

`PdfTab` 类型（[src/types.ts](src/types.ts)）现在有：

```ts
type PdfTab = {
  id: string;
  fileName: string;
  fileUrl: string;       // blob URL，每个 tab 一份独立
  cards: PassageCard[];
  lastPageIndex: number;  // 0-indexed，给 Viewer initialPage 用做粗定位
  lastScrollTop: number;  // 像素精确恢复
};
```

`PdfTabSummary` 现在包含 `fileUrl / lastPageIndex / lastScrollTop`（不再只是 id+fileName），因为 PdfPane 需要拿到这些字段去渲染每个 tab 的 Viewer。

回调签名也变了：以前是 `onActivePageIndexChange(pageIndex)`、`onActiveScrollTopChange(scrollTop)`（隐式作用于 active tab）；**现在是 `onTabPageIndexChange(tabId, pageIndex)`、`onTabScrollTopChange(tabId, scrollTop)`**——因为每个 PdfTabViewer 都可能 fire 事件，必须显式标识是哪个 tab。

### 15.3 数学公式 `\tag{}` 渲染：三层兜底逻辑

弱模型（gpt-5.4-mini、deepseek-v4-flash 等）经常输出错的公式格式，前端必须有兜底。逻辑全在 [src/components/PassageCard.tsx](src/components/PassageCard.tsx)。

| 模型输出形态 | 处理 |
|---|---|
| `$$ formula \tag{X} $$` 正确格式 | 直接走 ReactMarkdown + remark-math + rehype-katex |
| `$$ formula $$` <newlines> `\tag{X}` 单独段（**强模型常见**） | `mergeOrphanTags` 在 splitParagraphs 之前把孤儿 `\tag{X}` 合回前一个 `$$..$$` 块内 |
| 整段裸 LaTeX 无 `$` 包裹，含 `\tag{X}`（**弱模型常见**） | `wrapBareMathParagraph` 判断"段落含 `\tag{X}`、无 `$`、且至少 3 个 `\command`"→ 整段升为 display math |
| 真正孤立的 `\tag{X}`（无任何 LaTeX 上下文） | 保留为纯文本，**不要**包成 `$$ \tag{X} $$`——KaTeX 会因找不到要 tag 的表达式报错回落到红字源码 |

判定"至少 3 个 `\command`"的阈值是为了不误伤散文（如"We label equations using the `\tag{label}` macro"）。

**改 prompt 或新增模型时不要忘记验证这一层**：跑 [src/components/PassageCard.test.tsx](src/components/PassageCard.test.tsx) 里相关的 `it("re-attaches \\tag{}..."`、`it("wraps a tagged equation when weaker models..."`、`it("does not wrap prose that just mentions \\tag..."` 等用例。

### 15.4 OpenAI provider 现在有真模型选择 + reasoning effort

[src/components/ConnectionSettingsModal.tsx](src/components/ConnectionSettingsModal.tsx) 里 OpenAI 不再是手写文本框，而是下拉：

```ts
const OPENAI_MODEL_OPTIONS = [
  { value: "gpt-5.5", label: "gpt-5.5（最强）" },
  { value: "gpt-5.4", label: "gpt-5.4（平衡）" },
  { value: "gpt-5.3-codex-spark", label: "gpt-5.3-codex-spark（快速）" },
];
```

旧配置（如 `gpt-4o`）会以"自定义"形式保留在下拉里，无破坏性。

**Reasoning effort** 首次暴露给用户：`low / medium / high`，默认 `medium`（与 OpenAI 平台默认一致）。后端在 [server/providers/openaiProvider.ts](server/providers/openaiProvider.ts) 用 `openAIModelSupportsReasoning(model)` 判断是否传 `reasoning.effort`：

- 是 reasoning 模型（gpt-5.x、o1/o3/o4 系）→ 传 `reasoning: { effort }`，**省略 `temperature`**（这些模型会直接拒绝该参数）
- 不是 → 走原来的 `temperature` 路径，向后兼容

[server/runtimeConfig.ts](server/runtimeConfig.ts) 的 `testConnectionSettings` 同样需要这个分支判断，否则 reasoning 模型的连接测试会失败。**新增 reasoning 模型时这两处都要更新。**

### 15.5 React Hooks 在 react-pdf-viewer 里的几个隐藏坑

按踩坑频率排序：

1. **`searchPlugin()` 是 hook**（见 15.1.2）。同理推测 `pageNavigationPlugin()` / `zoomPlugin()` 也是 hook，全部必须组件顶层 unconditional 调用。
2. **`<Viewer>` 的 `defaultScale` 不响应 prop 变化**——只在 mount 时读一次。改 zoom 必须通过给 `<Viewer>` 加上 zoom-相关的 `key` 触发 remount，或者用 zoom plugin 的命令式 API。
3. **`<Viewer>` 的 `initialPage` 用 `useRunOnce(jumpToPage(initialPage))` 实现**（源码 `core.js:3891`）——`useRunOnce` 只在 component 生命周期内运行一次，所以 Viewer 不 remount 的话，改 initialPage prop 不会再次跳页。
4. **`<Worker>` 必须整个 app 只挂一次，不能给每个 Viewer 包一份**——它内部把 `PdfJsApi.GlobalWorkerOptions.workerSrc = workerUrl`，多份同时挂时虽然值相同但有竞争风险。`PdfPane` 现在把 `<Worker>` 包在所有 `<PdfTabViewer>` 外层一次。

### 15.6 Playwright 无头调试基础设施

`scripts/debug-*.mjs` 三个脚本是这一轮调试白屏 / 切换抽搐时建的，留着备后用：

- [scripts/debug-pdf-drop.mjs](scripts/debug-pdf-drop.mjs) — 开 headless Chromium，上传 PDF，捕获所有 console error / page error / network failure。**调"白屏类"bug 首选**。
- [scripts/debug-tab-switch.mjs](scripts/debug-tab-switch.mjs) — 打开两份 PDF，scroll 到 1200，切走再切回，验证 scrollTop 在各时间点是否被保留。**调"切换状态丢失"类 bug 首选**。
- [scripts/debug-switch-timing.mjs](scripts/debug-switch-timing.mjs) — 测量从点击 tab 到 canvas 真正完成 paint 的时延，逐 50ms 采样。**调"切换感觉卡"类问题首选**。

使用前要：
1. 起 dev server（`npm run dev`），等到 5173 + 8787 都响应
2. 准备一个或两个本地真实 PDF 路径作为参数
3. 必要时 `npx playwright install chromium` 拉一次浏览器

Playwright 是已声明的 devDependency。

### 15.7 默认排版变化

[src/components/AssistantPanel.tsx](src/components/AssistantPanel.tsx)：

```ts
const DEFAULT_FONT_LEVEL = 3; // → 15px (was 4 = 16px)
const DEFAULT_LINE_LEVEL = 3; // → 1.5  (was 4 = 1.6)
```

注意 `localStorage` 里的 `zhijiao-right-font-level` / `zhijiao-right-line-level` 会**覆盖**这些默认值，所以老用户更新后看不到变化是正常的——他们要么自己再调一次、要么去 Aa 面板点"默认"。

### 15.8 对前面章节的勘误

| 节 | 原文说法 | 实际现状 |
|---|---|---|
| **5.4** | "存在 `src/components/SelectionToolbar.tsx`，但当前主流程没有实际接入它" | 没记错，但 `translationTrigger` 配置已经形成熟双模式：`"selection"` = 选中即翻译（无右键菜单触发翻译），`"menu"` = 必须右键 → 翻译。这是 [src/components/ConnectionSettingsModal.tsx](src/components/ConnectionSettingsModal.tsx) 的"翻译触发"下拉。改这块时要同时改 `App.tsx` 的 `handleSelectionCaptured` 分支和 `PdfContextMenu` 的 `showTranslate` prop |
| **11.2** | "`SelectionToolbar.tsx` 当前未接入主流程" | 同上。组件文件存在但没引用，可以删除清理；保留也无害 |
| **6.2** | 列出 `setReasoningEffort` 只对 codex 生效 | v0.3.4 起 OpenAI runtime 也带 `setReasoningEffort` 实现，[server/index.ts](server/index.ts) 的 `setReasoningEffort` 路由分支同时更新 `state.settings.openai.reasoningEffort` |

### 15.9 当前已知未做的事 / 后续可能值得做的方向

按粒度从小到大：

- **Linux AppImage 文件名带 leading 横线**（`-0.3.4.AppImage`）：[electron-builder.json](electron-builder.json) 的 `linux.target` 没设 `artifactName` 模板，默认值在中文 productName 下生成出奇怪文件名。加一行 `"artifactName": "ZhijiaoReader-${version}.${ext}"` 即可。
- **`SelectionToolbar.tsx` 死代码可以删**（见 15.8）。
- **zoom 变化导致所有 Viewer remount**：当前 `<Viewer key={zoom}>` 让 zoom 切换重挂所有 tab 的 Viewer，等于丢了所有 tab 的 canvas。一次性代价；如果用户频繁缩放就感觉不好。要根治得引入 `@react-pdf-viewer/zoom` 插件做命令式 zoom，避免 remount。
- **PDF 选区翻译的"自动 vs 右键"开关**当前藏在设置弹窗里，新用户不一定知道。可以做引导。
- **多 Viewer 持久化的内存上限**：当前所有打开的 PDF 全部驻留内存。2-5 份没问题；如果用户开 10+ 份，可以加 LRU（最近最少访问的卸载、保留 scrollTop+pageIndex，下次再切回时只重新 mount 该 tab）。
- **本地 Codex 流式**：见 7.2 节，仍然是单 chunk 返回，UI 流式是模拟的。

### 15.10 这一轮迭代的提交参考

- v0.3.4 commit：[`225920c`](https://github.com/Yang-wentao/zhijiao-reader/commit/225920c) — 完整 commit message 里有所有改动的简短描述
- v0.3.4 release：https://github.com/Yang-wentao/zhijiao-reader/releases/tag/v0.3.4 — release notes 是中文用户向的详细 changelog，可以当作功能层面的索引

---

## 16. 给后续 agent 的工作提示

如果你接手做下一轮迭代，**先做这三件事**再开工：

1. **`git log --oneline -10`** 看最近 commit，确认你接到的是哪个版本的代码。如果发现 commit hash 不在 `225920c` 之后，先确认是不是分支没跟上 main。
2. **读完本文件第 15 节**（v0.3.4 新机制）—— 这部分是这次的"主要财富"，所有重要的"为什么这样写"都集中在这里。直接动 PdfPane 之前尤其要读 15.1。
3. **跑一次 `npm test`** 看 baseline 通不通。当前应该是 13 个测试文件、52 个用例通过，1 个失败（`src/components/PdfPane.test.tsx` 的 vite fs.allow 沙箱问题，与改动无关；详见 README 或之前的 commit message）。如果其他用例失败说明 worktree 状态有问题。

修改原则上沿用第 12 节"修改原则"，新增两条：

- **改 `PdfPane` 之前**：读完 15.1 + 15.5。`react-pdf-viewer` 的几个坑（hooks 规则、useRunOnce、IntersectionObserver、Worker 单例）都是踩过才知道的，别重蹈覆辙。
- **改公式渲染相关之前**：读完 15.3，并跑 `npx vitest run src/components/PassageCard.test.tsx` 看现有的 \tag 用例还过不过。

