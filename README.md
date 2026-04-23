# 知交文献阅读 / ZhiJiao Reader

[English README](README_en.md)

![image-20260412105222220](https://p.ipic.vip/a55won.png)

**知交文献阅读**是一个本地运行的 AI 文献阅读工具：左侧阅读 PDF，右侧即时显示翻译、术语解释和同段追问卡片。它主要面向中文学术阅读场景，支持官方DeepSeek、交大 API（包含 deepseek 等等）、本地 Codex，OpenAI API、以及自定义 OpenAI-compatible 接口。本项目由 Codex 完成主力项目工作，由本人和 Claude 提供实时指导工作。

### 做项目的动力来源

mac 端的用户是否正在为“知云文献翻译”软件不再更新而感到苦恼，却依然怀念知云文献翻译的软件界面？以及理科学生是否正在为通常的翻译软件难以正常翻译公式符号而感到痛苦？那么这款“知交文献阅读”就是为你量身定制的！

“知交文献阅读”参考了“知云文献阅读”的界面，做成一个本地优先的网页端文献阅读器：在 PDF 中划取文字后右键选择翻译或加入笔记，并且**翻译区集成了 markdown 的渲染环境**，结合 deepseek/local codox 可以自动显示出非常**视觉友好的翻译效果**，尽可能**原模原样地还原**出原始的英文语句格式！即使是错误识别的 OCR 文字，如封面图所示，配合 deepseek/local codex 依然可以呈现出正确的公式显示和文字翻译！

## 交大适配说明

本项目已经针对上海交通大学的 API 接入方式做了专门适配，默认提供了 `SJTU API` 连接选项，并优先兼容交大同学常用的模型配置流程。

如果你是交大的同学，并且已经申请到交大“致远一号”的测试 API，建议优先直接使用内置的 `SJTU API` 模式；配置路径更短，界面也已经提前做过适配；目前的测试结果是**官方/交大deepseek-chat**是最适合用来翻译的模型。也欢迎大家多多使用、继续反馈。

## 项目形态

- 前端：React + Vite
- 后端：Express + Node.js
- 桌面壳：Electron
- PDF 阅读：`@react-pdf-viewer/core`
- 公式渲染：`react-markdown` + `remark-math` + `rehype-katex`
- AI 后端：Local Codex CLI、DeepSeek API、SJTU API、OpenAI API、自定义兼容接口

默认运行方式是本地浏览器应用；仓库里也包含 Electron 打包配置，方便后续分发桌面版。

## 当前功能

- 打开本地 PDF 文件
- 同时打开多个 PDF，并用标签页切换
- 在 PDF 中选取段落文本后右键打开操作菜单
- 在右栏生成中文翻译卡片
- 将选区原文，或原文 + 译文，追加到本地 Obsidian vault 的 markdown 笔记
- 针对同一段落继续提问
- 支持复制、重试、折叠卡片
- 支持左右分栏阅读
- 支持切换 DeepSeek、SJTU API、OpenAI、Local Codex、自定义接口
- 在设置弹窗里测试连接后再保存配置
- 支持公式 markdown / KaTeX 渲染

## 环境要求

- Node.js 20+
- npm 10+
- 可选：如果要使用 `Local Codex`，需要本机已安装并可运行 `codex` CLI

## 快速启动

```bash
npm install
npm run launch
```

开发模式：

```bash
npm run dev
```

启动后：

1. 如果本地没有 `.env`，程序会自动从 `.env.example` 生成。
2. 如果还没有完成模型配置，右侧会提示你进入 `Settings`。
3. 如果要使用 Obsidian 笔记功能，在 `Settings` 里填写 vault 路径和摘录子目录。
4. 所有真实密钥和本地 vault 路径都只保存在本地，不会进入 git。

本地配置文件：

- 环境变量模板：`.env.example`
- 本地私有环境变量：`.env`
- 运行时 provider 配置：`config/providers.local.json`

其中 `.env` 和 `config/providers.local.json` 都已被 git 忽略。

## 一行命令安装

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/Yang-wentao/zhijiao-reader/main/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/Yang-wentao/zhijiao-reader/main/install.ps1 | iex
```

安装脚本会自动：

- 检查 `git`、`node`、`npm`
- 检查 Node.js 版本是否至少为 20
- 克隆仓库到本地
- 安装依赖
- 启动应用并自动打开浏览器

## 常用命令

```bash
npm run launch
npm run configure
npm run check
npm run release:zip
npm run electron:dev
npm run electron:pack
```

说明：

- `npm run launch`：本地一键启动
- `npm run configure`：在终端里预填 `.env` 默认配置
- `npm run check`：检查本地依赖与启动条件
- `npm run release:zip`：从当前已提交的 git 状态生成源码压缩包
- `npm run electron:dev`：Electron 开发模式
- `npm run electron:pack`：打包 Electron 应用

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8787`

## 下载与安装（macOS 桌面版）

> 推荐方式。从 [GitHub Releases](https://github.com/Yang-wentao/zhijiao-reader/releases) 下载对应的 DMG。

### 1. 选对应芯片的 DMG

| Mac 类型 | 下载文件 |
|---|---|
| Apple Silicon（M1 / M2 / M3 / M4） | `知交文献阅读-x.y.z-arm64.dmg` |
| Intel Mac | `知交文献阅读-x.y.z.dmg` |

不知道自己的 Mac 是哪种？点屏幕左上角 Apple → 关于本机，看"芯片"那一项。

### 2. 安装

1. 双击 DMG 打开
2. 把"知交文献阅读"图标**拖到 Applications 文件夹**
3. 关闭 DMG 窗口（在 Finder 边栏右键 DMG → 推出）

### 3. 第一次启动（重要！）

由于本项目暂未购买 Apple Developer ID 签名，macOS 第一次会弹出**"无法打开「知交文献阅读」，因为 Apple 无法检查它是否包含恶意软件"**。这是正常现象，按下面任一方法绕过：

**方法 A：右键打开（推荐）**
1. 在 Finder 里找到 `/Applications/知交文献阅读.app`
2. **右键** → 点"打开"
3. 弹窗里点"打开"
4. 之后双击就能正常启动了

**方法 B：终端一行命令（适合熟悉命令行的同学）**
```bash
xattr -dr com.apple.quarantine "/Applications/知交文献阅读.app"
```
跑完直接双击就能开。

> 如果你担心安全：本项目所有源码都在这个仓库公开，你可以自己检视、自己 build。我们会在攒到一定用户后申请 Apple Developer ID 真签名，那时就不会再有这个弹窗。

### 4. 第一次配置

应用打开后，右上角"设置"→ 选服务提供方（推荐 DeepSeek 或 SJTU API）→ 填 API key → 点"测试连接"通过 → 保存即可使用。

---

## 其他使用方式

### 从源码运行

如果你是开发者，或者想看看 / 改改代码：

```bash
git clone https://github.com/Yang-wentao/zhijiao-reader.git
cd zhijiao-reader
npm install
npm run launch
```

### 一行命令安装（开发者）

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/Yang-wentao/zhijiao-reader/main/install.sh | bash
```

如果使用者选择 `Local Codex`，仍需要在自己的电脑上单独安装 Codex CLI；这部分不会随本项目一起分发。

### 发布辅助文档

- [GitHub Distribution](docs/github-distribution.md)
- [Electron Packaging](docs/electron-packaging.md)
- [App 图标设计与流水线](docs/app-icon.md)

## 当前限制

- 暂不支持扫描版图片 PDF
- 页面刷新后，右栏卡片不会持久化
- OpenAI 模式需要有效的 `OPENAI_API_KEY`
- DeepSeek 模式需要有效的 `DEEPSEEK_API_KEY`
- SJTU API 模式需要有效的交大 API key
- 自定义接口需要兼容 OpenAI `/v1` 风格
- Local Codex 目前不是真正的 token 级流式返回，而是前端渐进显示
- Electron 打包已接入，但签名与 notarization 还未配置
