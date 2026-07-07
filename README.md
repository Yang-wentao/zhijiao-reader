# 知交文献阅读 / ZhiJiao Reader

[English README](README_en.md)

![image-20260412105222220](https://p.ipic.vip/a55won.png)

**知交文献阅读**是一个本地运行的 AI 文献阅读工具：左侧阅读 PDF，右侧即时显示翻译、术语解释和同段追问卡片；在原文上划线、写批注，并把它们写回 PDF 文件本身。它主要面向中文学术阅读场景，支持官方 DeepSeek、交大 API、OpenAI API、本地 Codex 以及任意 OpenAI-compatible 接口。

> **v1.0.0 —— 稳定版。** 从 2026 年 4 月的第一行代码到现在，这个软件走完了「能用 → 好用 → 完成」的全程。1.0 的含义不是「更多功能」，而是：核心循环（**选中 → 两秒内看懂 → 继续读**）已经完整、可靠，并经过日常真实使用的检验。
>
> 本项目由本人主导、与 AI 结对完成（Codex 与 Claude 先后承担主力开发）。

## 为什么做这个项目

Mac 端的同学是否正在为「知云文献翻译」不再更新而苦恼，却依然怀念它的阅读界面？理科学生是否受够了通用翻译软件把公式符号打成乱码？「知交文献阅读」就是为这两种痛苦做的：它参考了知云的双栏交互，做成一个**本地优先**的文献阅读器——划词即翻，翻译区自带完整的 Markdown + KaTeX 渲染环境，尽可能**原模原样地还原**英文原文的结构与公式。

## 它的优势

### 1. 公式渲染扛得住真实论文

翻译区不是纯文本框，而是 `react-markdown` + `remark-math` + KaTeX 的完整渲染管线，并针对真实模型输出做了多层兜底：

- 单行 `$$...$$` 自动升级为 display 模式（否则 `\tag{}` 会报错飘红）；
- 模型忘写定界符的裸 LaTeX 公式段自动识别并包裹；
- 游离在公式块外面的 `\tag{2.4}` 编号自动拼接回公式，编号正确地靠右显示。

结果是：即使换用较弱的快速模型，公式段落也能稳定渲染——这是通用翻译软件和多数同类工具做不到的。

### 2. 为长时间阅读设计的界面

暖纸色底、衬线正文、藏青主色的双栏排版，向知云的经典布局致敬，又比它更现代。右栏字号（12–20px）与行距（1.2–2.1）独立可调并记住偏好；卡片支持折叠、复制原文/译文、一键重试；新卡片自动置顶，读到深处有「回到顶部」悬浮键。所有界面与错误提示均为中文。

### 3. 划线与批注写回 PDF 文件本身

- 五色高亮 + 批注卡片（可拖动、可缩放），右键即用；
- `Cmd/Ctrl+S` 显式保存，`Cmd/Ctrl+Z` 撤销、`Shift+Cmd+Z` 重做；
- 批注以标准 PDF 注释格式**写入文件本身**——用 WPS、Adobe、macOS 预览打开同一个文件，划线和批注都在；反过来，别的软件里做的高亮，知交也能读出来；
- 写入采用「临时文件 + 原子替换」，不会损坏你的 PDF。

**你的数据不被这个应用绑架**——这是设计底线。

### 4. 摘录进你的笔记体系

右键选区即可把「原文」或「原文 + 译文」追加到本地 markdown 笔记文件夹（与 Obsidian vault 无缝兼容），按论文名自动归档、可带页码与时间戳。翻译尚未完成时，会在完成后自动补写进笔记。

### 5. 本地优先，接口随你换

前后端都跑在你自己的电脑上；API key 只存本地，永不进 git。五种服务方（DeepSeek / SJTU API / OpenAI / Local Codex / 自定义兼容接口）在设置里一键切换，保存前可先「测试连接」。客户端断开时后端会立即停止拉取模型输出——不为看不到的内容付费。

## 功能总览

- 打开本地 PDF（按钮 / 拖放），多标签页瞬时切换，记住每页阅读位置
- 划词自动翻译，或改为「右键菜单触发」防误触（设置中可切换）
- 翻译卡片：流式输出、术语解释单独成段、同段落连续追问（保留上下文）
- 五色高亮、批注卡片，写回 PDF 文件，兼容 WPS / Adobe / 预览
- 摘录原文 / 原文 + 译文到 markdown 笔记文件夹（Obsidian 兼容）
- 右栏字号、行距独立调节并持久化
- 五种 AI 服务方切换 + 连接测试 + 模型/思考力度选择
- 完整的 Markdown / KaTeX 公式渲染与多层兜底
- macOS DMG / Windows 安装包 / Linux AppImage，亦可源码运行

## 版本足迹

| 版本 | 内容 |
|---|---|
| v0.1.0 | 首个可用版本：双栏阅读器 + 划词翻译 + 流式卡片 |
| v0.2.0 | 首个 macOS 打包版（arm64 / x64 DMG）；全中文化；Obsidian 笔记（来自同学的 PR #1） |
| v0.2.1 | 笔记默认关闭；恢复「划词即译」 |
| v0.3.0 | DeepSeek v4 模型；翻译触发方式可选；Windows 安装包打磨 |
| v0.3.2 | 拖放打开 PDF；字号/行距调节；`\tag{}` 公式渲染修复 |
| v0.3.4 | 标签页瞬时切换；OpenAI 模型选择器 + 思考力度 |
| v0.3.5 | PDF 高亮 + 批注写回文件（WPS / Adobe 互通）；显式保存与撤销/重做 |
| v0.3.6 | 错误提示全中文化；断开连接即停止计费流；模型下拉框修复 |
| **v1.0.0** | **稳定版定版：无新增功能——1.0 的含义是「完成」** |

## 交大适配说明

本项目对上海交通大学的 API 做了专门适配，内置 `SJTU API` 连接选项。如果你是交大同学并已申请到「致远一号」测试 API，直接选它即可，配置路径最短；实测 **deepseek-chat**（官方或交大版）是最适合翻译的模型。

## 下载与安装（macOS 桌面版）

> 推荐方式。从 [GitHub Releases](https://github.com/Yang-wentao/zhijiao-reader/releases) 下载对应的 DMG。

### 1. 选对应芯片的 DMG

| Mac 类型 | 下载文件 |
|---|---|
| Apple Silicon（M1 / M2 / M3 / M4） | `ZhijiaoReader-x.y.z-arm64.dmg` |
| Intel Mac | `ZhijiaoReader-x.y.z-x64.dmg` |

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

> 如果你担心安全：本项目所有源码都在这个仓库公开，你可以自己检视、自己 build。

### 4. 第一次配置

应用打开后，右上角"设置"→ 选服务提供方（推荐 DeepSeek 或 SJTU API）→ 填 API key → 点"测试连接"通过 → 保存即可使用。

---

## 下载与安装（Windows 桌面版）

> 同样从 [GitHub Releases](https://github.com/Yang-wentao/zhijiao-reader/releases) 下载安装。

### 1. 下载

| 系统 | 下载文件 |
|---|---|
| Windows 10 / 11 (x64) | `ZhijiaoReader-Setup-x.y.z-x64.exe` |

### 2. 安装

1. 双击 `.exe` 启动 NSIS 安装向导
2. 选安装位置（默认在用户目录下）→ 安装
3. 装完会在桌面 / 开始菜单里出现"知交文献阅读"快捷方式

### 3. 第一次启动（重要！）

跟 macOS 类似，本项目暂未购买 Windows 代码签名证书，所以**首次安装和首次启动会被 SmartScreen 拦下**：

**安装时**：弹出 **"Windows 已保护你的电脑"** → 点 **"更多信息"** → 点 **"仍要运行"**

**启动时**（如果还有警告）：右键应用 → "属性" → 勾选底部的 **"解除锁定"** → 确定

### 4. 第一次配置

同 macOS 步骤——右上角"设置"→ 选 provider → 填 API key → 测试连接 → 保存。

---

## 从源码运行

环境要求：Node.js 20+、npm 10+（可选：使用 `Local Codex` 需本机可运行 `codex` CLI）。

```bash
git clone https://github.com/Yang-wentao/zhijiao-reader.git
cd zhijiao-reader
npm install
npm run launch
```

启动后：

1. 如果本地没有 `.env`，程序会自动从 `.env.example` 生成。
2. 如果还没有完成模型配置，右侧会提示你进入 `Settings`。
3. 如果要使用笔记功能，在 `Settings` 里填写笔记文件夹路径和摘录子目录。
4. 所有真实密钥和本地路径都只保存在本地（`.env`、`config/providers.local.json`），已被 git 忽略。

一行命令安装（macOS / Linux）：

```bash
curl -fsSL https://raw.githubusercontent.com/Yang-wentao/zhijiao-reader/main/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/Yang-wentao/zhijiao-reader/main/install.ps1 | iex
```

### 常用命令

```bash
npm run launch        # 本地一键启动
npm run dev           # 开发模式（前端 5173 / 后端 8787）
npm test              # 测试
npm run check         # 检查本地依赖与启动条件
npm run electron:dev  # Electron 开发模式
npm run electron:pack # 打包桌面应用
```

### 开发者文档

- [AGENTS.md](AGENTS.md) — 工程手册（模块导读、常见任务、坑点）
- [GitHub Distribution](docs/github-distribution.md)
- [Electron Packaging](docs/electron-packaging.md)
- [App 图标设计与流水线](docs/app-icon.md)

## 当前限制

- 暂不支持扫描版图片 PDF（文字不可选中的那种）
- 页面刷新 / 重启后，右栏翻译卡片不会持久化（高亮与批注在 PDF 文件里，不受影响）
- 高亮批注写回文件需要桌面版（浏览器模式拿不到真实文件路径）
- Local Codex 不是真正的 token 级流式返回，而是前端渐进显示
- 安装包未做代码签名与 notarization（首次启动需按上文手动放行）
