[![](https://img.shields.io/badge/🇬🇧-English-000aff?style=flat)](README.md)
[![](https://img.shields.io/badge/🇯🇵-日本語-bc002d?style=flat)](README_ja.md)
[![](https://img.shields.io/badge/🇨🇳-中文版-ff0000?style=flat)](README_zh.md)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white)](https://discord.gg/rdftVMaUcS)
[![](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

<hr>

> 无需更改 Claude Code 配置，即可将请求路由到任意 LLM 提供商的强大代理。

## ✨ 功能

- **基于任务的路由** — 为六个内置场景分别指定不同模型：`default`、`background`、`think`（计划模式）、`longContext`、`webSearch`、`image`。
- **多提供商支持** — 连接 API Key 型提供商（Anthropic、OpenAI、DeepSeek、Gemini、Groq、OpenRouter 等）或订阅型提供商（Claude Code OAuth、OpenAI Codex）。
- **订阅监控** — 追踪速率限制窗口，比较实际 API 费用与订阅费用。
- **用量与成本仪表板** — 按提供商和模型细分的费用明细及每日费用图表。
- **请求历史** — 浏览和重放过去的 LLM 请求。
- **Web 管理界面** — 完整的浏览器端配置管理，无需手动编辑 JSON。
- **转换器管道** — 内置和自定义转换器将 Anthropic 格式请求适配至各提供商 API。
- **自定义 JavaScript 路由器** — 实现超出六个内置场景的任意路由逻辑。
- **子代理模型锁定** — 通过内联提示标签将子代理定向到指定提供商和模型。
- **状态栏** — 在 Claude Code 状态栏中实时显示 CCR 状态。
- **Docker 优先部署** — 包含 PostgreSQL 和 Redis 的一键 `docker compose up -d`。

## 🖥️ Web 界面

![Models 页面](docs/images/screenshot-models.webp)

Web 界面（默认在端口 **3456** 提供服务）让您全面掌控路由器的各项设置：

| 页面 | 用途 |
|------|------|
| **Models** | 查看已启用模型、价格、上下文窗口及连接测试 |
| **Providers** | 添加、编辑或删除 API Key 型和订阅型提供商 |
| **Router** | 为每个路由场景分配模型 |
| **Subscriptions** | 监控速率限制窗口，比较订阅费用与 API 支出 |
| **Usage** | 按提供商和模型细分的 API 费用及时序图表 |
| **History** | 浏览历史请求日志 |
| **Settings** | 配置主机、端口、代理、日志、状态栏和 API Key |

![Providers 页面](docs/images/screenshot-providers.webp)

![Router 页面](docs/images/screenshot-router.webp)

![Usage 页面](docs/images/screenshot-usage.webp)

## 🚀 Docker 快速启动（推荐）

安装 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/) 后：

**第一步 — 创建工作目录和最小配置文件：**

```shell
mkdir -p ~/ccr ~/.claude-code-router
cd ~/ccr

cat > ~/.claude-code-router/config.json << 'EOF'
{
  "APIKEY": "your-secret-key"
}
EOF
```

> `APIKEY` 用于保护 Web 界面和 `/v1/*` 代理。如果省略，首次启动时会自动生成并打印到服务器控制台。

**第二步 — 下载 `compose.yaml`：**

```shell
curl -fsSL https://raw.githubusercontent.com/musistudio/claude-code-router/main/compose.yaml -o compose.yaml
```

**第三步 — （可选）将提供商凭据写入 `.env`：**

```shell
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
ANTHROPIC_API_KEY=sk-ant-...
EOF
```

**第四步 — 启动服务：**

```shell
docker compose up -d
```

服务在 `http://127.0.0.1:3456` 启动。在浏览器中打开该地址，使用 `APIKEY` 登录，然后在 **Providers** 和 **Router** 页面完成配置。

**第五步 — 将 Claude Code 指向路由器：**

```shell
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=your-secret-key claude
```

或在 Shell 配置文件中永久设置：

```shell
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=your-secret-key
```

**查看日志：**

```shell
docker compose logs -f
```

**应用配置更改：**

```shell
docker compose restart
```

## 🔌 连接提供商

### API Key 型提供商

在 **Providers** 页面选择任意 API Key 型提供商（Anthropic、OpenAI、DeepSeek、Gemini 等），输入 API Key 并保存。支持 `$VAR` 格式的环境变量插值，无需将密钥明文写入配置文件。

### 订阅型提供商（Claude Code 与 Codex）

CCR 支持通过订阅型提供商进行路由，无需单独的 API Key。

**Claude Code** — 打开 **Providers** 页面 → **Subscription** 标签页 → **Connect**，完成 OAuth 授权流程。CCR 会自动存储并刷新凭据。

**Codex（OpenAI）** — 目前不支持通过浏览器登录，仅支持通过上传凭据文件的方式进行认证。

![Subscriptions 页面](docs/images/screenshot-subscriptions.webp)

> **服务条款提示：** 将 Claude Code 订阅用于 Claude Code 以外的应用程序请求，可能违反 [Anthropic 使用政策](https://www.anthropic.com/legal/aup)。请自行评估风险后使用此功能。

## ⚙️ 配置

### 磁盘配置（`~/.claude-code-router/config.json`）

存储启动时的标量值和磁盘常驻对象。支持环境变量插值（`$VAR` / `${VAR}`）和 JSON5 注释。自动保留最近三个备份。

| 键 | 说明 |
|----|------|
| `APIKEY` | 客户端须通过 `x-api-key` 或 `Authorization: Bearer` 发送的密钥 |
| `HOST` | 监听地址。默认 `127.0.0.1`；反向代理后端使用 `0.0.0.0`（需要 `APIKEY`）|
| `PORT` | 监听端口（默认：`3456`）|
| `LOG` | `true` 以启用日志文件 |
| `LOG_LEVEL` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `PROXY_URL` | 上游 API 请求的 HTTP 代理 |
| `API_TIMEOUT_MS` | 上游 API 调用超时时间（ms，默认：`600000`）|
| `CLAUDE_PATH` | `claude` 可执行文件路径 |
| `NON_INTERACTIVE_MODE` | Docker / CI 环境下设为 `true`（防止 stdin 挂起）|
| `CUSTOM_ROUTER_PATH` | 自定义 JavaScript 路由器模块的绝对路径 |

### 提供商、模型与路由器（数据库）

首次启动后，提供商、模型和路由槽位通过 Web 界面或配置 API 在 PostgreSQL 中管理（而非 `config.json`）。首次启动时，`config.json` 中的 `Providers` / `Router` 会自动迁移到数据库（一次性、幂等）。

### 路由场景

在 **Router** 页面为每个场景配置使用的模型：

| 场景 | 触发时机 |
|------|---------|
| `default` | 未匹配其他场景的所有请求 |
| `background` | 轻量级后台任务 |
| `think` | 推理密集型任务（计划模式）|
| `longContext` | 超过上下文阈值的请求（默认 60 000 token）|
| `webSearch` | 网络搜索任务（需要模型原生支持搜索）|
| `image` | 图像相关任务（使用 CCR 内置图像代理）|

### 转换器

转换器将 Anthropic 格式请求适配为各提供商的接口格式。

**内置转换器：**

| 转换器 | 说明 |
|--------|------|
| `Anthropic` | 原生 Anthropic 端点的直通转发 |
| `claude-code-credentials` | 使用本地 Claude Code OAuth Token（`~/.claude/.credentials.json`），支持自动刷新 |
| `openai-responses` | OpenAI Responses API（`/v1/responses`）—用于 Codex 模型 |
| `OpenAI` | 标准 OpenAI Chat Completions API |
| `deepseek` | DeepSeek API |
| `gemini` | Google Gemini API |
| `openrouter` | OpenRouter API（支持 `provider` 路由参数）|
| `groq` | Groq API |
| `maxtoken` | 覆盖 `max_tokens`（接受 `{ "max_tokens": N }` 选项）|
| `tooluse` | 通过 `tool_choice` 优化工具调用 |
| `reasoning` | 处理 `reasoning_content` 字段 |
| `sampling` | 处理采样字段（`temperature`、`top_p`、`top_k`、`repetition_penalty`）|
| `enhancetool` | 为工具调用参数增加容错处理（禁用流式工具调用）|
| `cleancache` | 从请求中移除 `cache_control` |
| `vertex-gemini` | 通过 Vertex AI 认证访问 Gemini |
| `gemini-cli` *（实验性）* | 通过 Gemini CLI 的非官方 Gemini 支持 |
| `qwen-cli` *（实验性）* | 通过 Qwen CLI 的非官方 qwen3-coder-plus 支持 |
| `rovo-cli` *（实验性）* | 通过 Atlassian Rovo Dev CLI 的非官方 GPT-5 支持 |

**自定义转换器插件：**

通过磁盘配置加载 JavaScript 模块来添加自定义转换器：

```json
{
  "transformers": [
    {
      "path": "/home/user/.claude-code-router/plugins/my-transformer.js",
      "options": { "someOption": "value" }
    }
  ]
}
```

**转换器配置示例：**

```json
{
  "name": "openrouter",
  "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
  "api_key": "$OPENROUTER_API_KEY",
  "models": ["google/gemini-2.5-pro", "anthropic/claude-sonnet-4"],
  "transformer": { "use": ["openrouter"] }
}
```

特定模型的转换器：

```json
{
  "name": "deepseek",
  "api_base_url": "https://api.deepseek.com/chat/completions",
  "api_key": "$DEEPSEEK_API_KEY",
  "models": ["deepseek-chat", "deepseek-reasoner"],
  "transformer": {
    "use": ["deepseek"],
    "deepseek-chat": { "use": ["tooluse"] }
  }
}
```

带选项的转换器：

```json
{
  "transformer": {
    "use": [["maxtoken", { "max_tokens": 65536 }], "enhancetool"]
  }
}
```

### 自定义 JavaScript 路由器

对于超出六个内置场景的路由逻辑，在磁盘配置中设置 `CUSTOM_ROUTER_PATH`：

```json
{
  "CUSTOM_ROUTER_PATH": "/home/user/.claude-code-router/custom-router.js"
}
```

该模块必须导出一个返回 `"provider,model"` 或 `null`（回退到默认路由）的 `async` 函数：

```javascript
module.exports = async function router(req, config) {
  const userMessage = req.body.messages.find(m => m.role === 'user')?.content;
  if (userMessage?.includes('解释这段代码')) {
    return 'openrouter,anthropic/claude-3.5-sonnet';
  }
  return null;
};
```

完整示例请参阅仓库根目录的 `custom-router.example.js`。

### 子代理路由

在子代理提示词开头添加以下标签将其锁定到特定模型：

```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
请帮我分析这段代码...
```

## 📊 日志

- **服务器级日志**（pino）：`~/.claude-code-router/logs/ccr-*.log` — HTTP 请求、API 调用、服务器事件。级别由 `LOG_LEVEL` 控制。
- **应用级日志**：`~/.claude-code-router/claude-code-router.log` — 路由决策和业务逻辑事件。

## 🛠️ 开发

### 前置条件

- Bun ≥ 1.1.0
- PostgreSQL
- Redis

开发容器（`.devcontainer/compose.yaml`）会自动提供 `postgres` 和 `redis`。

### 初始化

```shell
bun install
```

```shell
# .env
DATABASE_URL=postgres://postgres:password@postgres:5432/ccr
REDIS_URL=redis://redis:6379
```

```shell
bun run db:migrate
bun run dev         # Vite 开发服务器（端口 16173）
```

### 构建

```shell
bun run build       # Vite 生产构建（SPA 输出到 dist/）
```

### 测试

```shell
bun run test              # 单元测试和数据库测试
bun run test:providers    # 提供商集成测试
```

### 数据库工具

| 脚本 | 用途 |
|------|------|
| `bun run db:generate` | 重新生成 Prisma 客户端 |
| `bun run db:migrate` | 创建并应用迁移（开发）|
| `bun run db:migrate:deploy` | 应用现有迁移（生产 / CI）|
| `bun run db:reset` | 删除并重建 schema（破坏性）|
| `bun run db:studio` | 打开 Prisma Studio |

请始终通过 Prisma 迁移管理 schema，切勿直接编辑 DDL。

### 价格数据抓取

| 脚本 | 用途 |
|------|------|
| `bun run scrape:openai-prices` | 抓取 OpenAI 模型价格 |
| `bun run scrape:anthropic-prices` | 抓取 Anthropic 模型价格 |
| `bun run scrape:google-prices` | 抓取 Google / Gemini 价格 |
| `bun run scrape:prices` | 抓取以上所有价格 |

### 发布

| 脚本 | 用途 |
|------|------|
| `bun run release` | 构建并发布 Docker 镜像 |
| `bun run release:docker` | 仅发布 Docker 镜像 |

## 许可证

MIT — 详见 `LICENSE`。
