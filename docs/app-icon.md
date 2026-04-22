# App 图标设计与打包流水线

记录知交文献阅读 macOS App 的图标从零到成品 `.app` Bundle 的完整过程：设计迭代经验、多尺寸生成脚本、electron-builder 集成方式，以及最终验证流程。

## 1. 设计迭代回顾

从零到定稿经历了 7 个版本的 prompt + AI 生成迭代：

| 版本 | 方向 | 主要问题 / 收获 |
|---|---|---|
| V1 | 白底 + 深蓝实心书 + 金色星 | 方向对，但书过"实心"没有文献感；星星发光偏卡通；白底在 Dock 里与其他白底 App 融为一体 |
| V2 | 加入浅蓝文字线 + 金色光点 + 虚线轨迹 | 叙事清晰（"文献中浮现的灵感"），但小尺寸下所有细节消失 |
| V3 | 天蓝背景 + 奶白色书 + 星书融合 | 方向大改对了，但"星星长在书顶"在 AI 生成时失败——画成了半遮掩状态 |
| V4–V5 | 放弃融合，星星完整悬浮于书上方 | 加入柔和光晕 + 两颗副 sparkle 点缀"AI 魔法"气质 |
| V6 | 书本从 60%+ 缩到 ~52%，光晕收敛 | 参照 Telegram / WeChat 比例，留白均匀 |
| **V7（定版）** | 锐利 sparkle + 整体平衡 | 天蓝渐变 + 奶白书 + 金色 sparkle + 小 sparkle 点缀 |

## 2. 过程中总结的经验

### AI 图像生成

- **精确比例指令基本无效**：`52% canvas`、`25% canvas` 这类数字会被忽略，AI 回归到自己训练的"美学默认值"。真正有用的是**相对量级对比**（`much larger`、`fully visible, NOT overlapping`）
- **负向说明更有效**：`NOT tucked behind`、`AVOID bottom edge` 等反向约束对产出的影响大于正向描述
- **最后 10% 靠手动微调**：迭代到 9/10 之后，继续刷 prompt 的边际收益迅速递减。10 像素级别的调整用图像编辑器更可控

### macOS 图标语言

- **32×32 是唯一的真理**：小尺寸下消失的元素在设计里等于不存在
- **留白决定气质**：主体占画布 ~50-55% + 均匀四周留白，是 Big Sur 的典型比例（Telegram / WeChat / Typora 全在这个范围）
- **背景色是身份证**：纯白背景在 Dock 里容易"隐身"；带色块的背景（渐变蓝、绿、橙）才能脱颖而出
- **sparkle 是 AI 产品视觉共识**：2025–2026 年 Apple Intelligence、Claude、ChatGPT、Notion AI 全部使用，比"灯泡"更像产品、比"齿轮"更像智能

## 3. 最终 prompt

```
A clean, modern macOS app icon, 512×512.

Background: a rounded square with a smooth sky blue vertical gradient
(#38BDF8 at top → #0284C7 at bottom), luminous like a clear sky.

Center element: a bold open book in warm off-white (#FEFBF4), viewed
from a slight front-facing angle, pages spread symmetrically with
gentle curves like a real open book. The book fills ~52% of the
canvas — similar breathing room to the Telegram or WeChat macOS icon.
Positioned slightly below the optical center.

Above the book, a confident four-pointed sparkle in warm gold (#FBBF24):
- Fully visible, floating freely above the book, NOT overlapping it
- ~25% of the canvas height tall, legible at 32×32
- Wrapped in a soft halo (#FEF3C7 at 35% opacity, fading over 1.3×
  the sparkle's radius) — subtle, not a bright bloom
- Flanked by two tiny secondary sparkles at ~1/3 main size, placed
  upper-left and lower-right

On each book page, 3–4 thin horizontal lines in soft sky-blue
(#BAE6FD) suggest text. Soft drop shadow beneath the book.

Style: SF Symbols meets macOS Big Sur. No text, no clutter.
```

## 4. 资源目录结构

所有图标资源放在 `resources/icons/`（**不用 `build/`，因为 `build/` 已被 `.gitignore`**）：

| 文件 | 作用 | 尺寸 |
|---|---|---|
| `icon-source.png` | 主图——设计更新时替换它 | 严格 1024×1024 |
| `icon.icns` | macOS Bundle 图标，由脚本生成 | 内含 16→1024 全套 |
| `icon.png` | Linux / Windows 运行时图标 | 1024×1024 |

## 5. 多尺寸生成

[scripts/generate-icons.mjs](../scripts/generate-icons.mjs) 使用 macOS 自带工具（`sips` + `iconutil`），从 `icon-source.png` 一键生成全套资源：

```bash
npm run icons
```

脚本三步：

1. **校验**：源图必须严格 1024×1024，否则拒绝（避免产出模糊的 `.icns`）
2. **多尺寸生成**：用 `sips` 产出 10 个 PNG 放入 `AppIcon.iconset/`
3. **打包**：用 `iconutil -c icns` 把 iconset 合成单个 `.icns`，并把源图复制为 `icon.png`

`.icns` 内嵌的尺寸（遵循 Apple 规范）：

| iconset 文件名 | 像素尺寸 | 用途 |
|---|---|---|
| `icon_16x16.png` | 16×16 | 菜单栏 @1x |
| `icon_16x16@2x.png` | 32×32 | 菜单栏 @2x |
| `icon_32x32.png` | 32×32 | Spotlight |
| `icon_32x32@2x.png` | 64×64 | Spotlight @2x |
| `icon_128x128.png` | 128×128 | Finder 列表视图 |
| `icon_128x128@2x.png` | 256×256 | Finder 列表 @2x |
| `icon_256x256.png` | 256×256 | Finder 中图标 |
| `icon_256x256@2x.png` | 512×512 | Finder 中图标 @2x |
| `icon_512x512.png` | 512×512 | Dock / Finder 大图标 |
| `icon_512x512@2x.png` | 1024×1024 | Retina 大图标、App Store |

### Windows `.ico` 说明

脚本没生成 `.ico`（macOS 自带工具不支持）。策略：
- 默认：electron-builder 在 Windows 目标构建时从 `icon.png` 自动合成
- 若需手工优化的多分辨率 `.ico`，可单独用 `png-to-ico` 或 ImageMagick 生成，放到 `resources/icons/icon.ico`，再更新 `electron-builder.json` 的 `win.icon` 引用

## 6. Electron 集成

### [electron-builder.json](../electron-builder.json)

```json
{
  "extraResources": [
    { "from": "resources/icons/icon.png", "to": "icon.png" }
  ],
  "mac":   { "icon": "resources/icons/icon.icns" },
  "win":   { "icon": "resources/icons/icon.png" },
  "linux": { "icon": "resources/icons/icon.png" }
}
```

- `mac.icon` 指向 `.icns` → 进入 `.app/Contents/Resources/icon.icns`，被 `Info.plist` 的 `CFBundleIconFile` 引用
- `win.icon` / `linux.icon` 指向 PNG
- `extraResources` 把 PNG 复制到运行时 `process.resourcesPath`，供 BrowserWindow 读取

### [electron/main.mjs](../electron/main.mjs)

BrowserWindow 加 `icon` 属性，dev/packaged 路径自动切换：

```js
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(__dirname, "..", "resources", "icons", "icon.png");

new BrowserWindow({
  // ...
  icon: appIconPath,
});
```

- macOS 下此属性被忽略（用 Bundle 图标）
- Linux AppImage / Windows 运行时的任务栏 & 标题栏图标会用到这个

## 7. 打包流程

### 一次性准备

```bash
npm install
```

### 设计迭代

设计更新时：

```bash
# 1. 替换主图
cp new-design.png resources/icons/icon-source.png

# 2. 生成多尺寸
npm run icons

# 3. 提交
git add resources/icons/
git commit -m "chore: update app icon"
```

### 打包分发

```bash
npm run electron:pack
```

流程：
1. `tsc -b && vite build` — 前端编译到 `dist/`
2. `tsc -p tsconfig.server.json` — 服务端编译到 `build/server/`
3. `electron-builder` — 组装 `.app` + `.zip`

产物（`.gitignore` 中已忽略）：
- `release/electron/mac-arm64/知交文献阅读.app` — 可直接运行
- `release/electron/知交文献阅读-0.1.0-arm64-mac.zip` — ~118 MB 分发包

### 验证

```bash
# Finder 中查看图标
open -R release/electron/mac-arm64/知交文献阅读.app

# 确认 Info.plist 引用
plutil -p release/electron/mac-arm64/知交文献阅读.app/Contents/Info.plist \
  | grep -iE "icon|bundle"

# 确认 .icns 合法
file release/electron/mac-arm64/知交文献阅读.app/Contents/Resources/icon.icns
```

期望输出：
- `CFBundleIconFile => "icon.icns"`
- `Mac OS X icon, ... bytes, "ic12" type`

## 8. 已知局限 & 后续工作

- **当前只打 macOS arm64**：electron-builder 在 macOS 上默认仅当前平台。Intel Mac 加 `--mac --x64`；Linux AppImage 需 Docker；Windows 需在 Windows 机或 CI 上打
- **仅 ad-hoc 签名**（`identityName=-`）：首次启动会弹出"来自未知开发者"提示，右键打开即可。正式分发需要：
  - Apple Developer ID（$99/年）做真签名
  - 配置 electron-builder `notarize` 做 Apple 公证
- **无 auto-update**：若要做增量更新，需接入 `electron-updater` 并托管 `latest-mac.yml`
- **仓库里没有 Windows `.ico`**：默认由 electron-builder 从 PNG 合成；如果 Windows 是重点分发目标，建议补上手工优化的多分辨率 `.ico`
