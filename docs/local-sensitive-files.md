# 本地敏感文件说明

本文件记录知交文献阅读项目中**不应提交到 Git** 的本地敏感文件，以及它们各自的用途。

---

## 当前已确认敏感文件

### 1. `.env`

路径：

- `/Users/yangwentao/Documents/软件开发尝试/.env`

可能包含：

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `SJTU_API_KEY`
- 其他 provider 默认配置

风险：

- 如果误提交，会直接泄露真实 API key

处理规则：

- 永远不要把真实 `.env` 提交到仓库
- 示例配置只能写进 `.env.example`
- `.env.example` 中不得出现真实 key

---

### 2. `config/providers.local.json`

路径：

- `/Users/yangwentao/Documents/软件开发尝试/config/providers.local.json`

可能包含：

- 当前激活 provider
- DeepSeek / SJTU / OpenAI / custom API key
- 模型名
- base URL

风险：

- 它通常比 `.env` 更贴近真实使用状态，更容易带出真实配置

处理规则：

- 永远不要把真实 `providers.local.json` 提交
- 不要在 issue、README、截图中暴露其中内容

---

## 建议额外关注的敏感类型

如果后续仓库里出现以下文件，也应默认视为敏感文件：

- `*.pem`
- `*.key`
- `*.p12`
- `*.mobileprovision`
- 任何包含 `secret`、`token`、`credential`、`private` 的本地配置文件

---

## 推荐处理原则

1. 本地真实配置只保留在本机
2. 提交到仓库的只应是：
   - `.env.example`
   - 文档里的占位符配置
   - 不含真实密钥的测试样例
3. 在截图、录屏、README、release 文案中避免暴露：
   - API key
   - 完整 base URL 中的私有路径
   - 账号名 / token / credential

---

## 当前结论

截至当前工作区，最明确需要重点保护的文件就是：

- `.env`
- `config/providers.local.json`

后续如果项目迁移到 Electron 用户目录保存配置，也应同步把新的用户配置文件路径加入本说明文档。
