[![](https://img.shields.io/badge/🇬🇧-English-000aff?style=flat)](README.md)
[![](https://img.shields.io/badge/🇯🇵-日本語-bc002d?style=flat)](README_ja.md)
[![](https://img.shields.io/badge/🇨🇳-中文版-ff0000?style=flat)](README_zh.md)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white)](https://discord.gg/rdftVMaUcS)
[![](https://img.shields.io/github/license/tkgstrator/rialto)](https://github.com/tkgstrator/rialto/blob/master/LICENSE)

<hr>

> 无需更改 Claude Code 配置，即可将请求路由到任意 LLM 提供商的强大代理。

## ✨ 功能

- **基于任务的路由** — 为六个内置场景分别指定不同模型：`default`、`background`、`think`（计划模式）、`longContext`、`webSearch`、`image`。
- **配额感知的兜底链** — 每个场景拥有有序的兜底链，当订阅型提供商越过其周维度排空目标时主动切换。effort 与模型层级信号将轻量请求引向 Sonnet，重量请求引向 Opus。
- **人格** — 在不修改 Claude Code 的前提下，为每个面向用户的请求追加一段命名的系统提示。在 Personas 页面管理库，在 Router 页面选择当前生效的人格。
- **多提供商支持** — 连接 API Key 型提供商（Anthropic、OpenAI、DeepSeek、Gemini、Groq、OpenRouter 等）或订阅型提供商（Claude Code OAuth、OpenAI Codex）。
- **订阅监控** — 追踪速率限制窗口，比较实际 API 费用与订阅费用。
- **用量与成本仪表板** — 按提供商和模型细分的费用明细及每日费用图表。
- **请求历史** — 浏览过去的会话，包含每个请求的统计信息和已归档的对话记录。
- **Web 管理界面** — 完整的浏览器端配置管理，无需手动编辑 JSON。
- **转换器管道** — 内置和自定义转换器将 Anthropic 格式请求适配至各提供商 API。
- **自定义 JavaScript 路由器** — 实现超出六个内置场景的任意路由逻辑。
- **子代理模型锁定** — 通过内联提示标签将子代理定向到指定提供商和模型。
- **状态栏** — 在 Claude Code 状态栏中实时显示 Rialto 状态。
- **Docker 优先部署** — 包含 PostgreSQL 和 Redis 的一键 `docker compose up -d`。

## 🖥️ Web 界面

![Models 页面](docs/images/screenshot-models.webp)

Web 界面（默认在端口 **3456** 提供服务）让您全面掌控路由器的各项设置：

| 页面 | 用途 |
|------|------|
| **Models** | 查看已启用模型、价格、上下文窗口及连接测试 |
| **Providers** | 添加、编辑或删除 API Key 型和订阅型提供商 |
| **Router** | 为每个路由场景分配模型，并选择当前生效的人格 |
| **Personas** | 管理命名系统提示的人格库（新增、编辑、删除）|
| **Subscriptions** | 监控速率限制窗口，比较订阅费用与 API 支出 |
| **Usage** | 按提供商和模型细分的 API 费用及时序图表 |
| **Sessions** | 浏览过去的会话；深入查看每个请求的日志和已归档的对话 |
| **Settings** | 配置主机、端口、代理、日志、状态栏和 API Key |

![Providers 页面](docs/images/screenshot-providers.webp)

![Router 页面](docs/images/screenshot-router.webp)

![Usage 页面](docs/images/screenshot-usage.webp)

## 🚀 Docker 快速启动（推荐）

安装 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/) 后：

**第一步 — 创建工作目录和最小配置文件：**

```shell
mkdir -p ~/rialto ~/.rialto
cd ~/rialto

cat > ~/.rialto/config.json << 'EOF'
{
  "APIKEY": "your-secret-key"
}
EOF
```

> `APIKEY` 用于保护 Web 界面（`/api/*`）。如果省略，首次启动时会自动生成并打印到服务器控制台。
>
> **它不能用于 `/v1/*` 的认证。** 客户端使用在 **Settings → Access** 中签发的*访问令牌*连接：可单独吊销、可按请求归属、可限定到某个端点与路由配置。未签发任何令牌的实例无法通过代理。

**第二步 — 下载 `compose.yaml`：**

```shell
curl -fsSL https://raw.githubusercontent.com/tkgstrator/rialto/master/compose.yaml -o compose.yaml
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

服务在 `http://127.0.0.1:3456` 启动。在浏览器中打开该地址，使用 `APIKEY` 登录，然后在 **Providers** 和 **Routing** 页面完成配置。接着在 **Settings → Access** 签发访问令牌 —— 客户端认证使用的是它。

**第五步 — 将 Claude Code 指向路由器：**

```shell
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=rialto_your-access-token claude
```

或在 Shell 配置文件中永久设置：

```shell
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=rialto_your-access-token
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

Rialto 支持通过订阅型提供商进行路由，无需单独的 API Key。

**Claude Code** — 打开 **Providers** 页面 → **Subscription** 标签页 → **Connect**，完成 OAuth 授权流程。Rialto 会自动存储并刷新凭据。

**Codex（OpenAI）** — 目前不支持通过浏览器登录，仅支持通过上传凭据文件的方式进行认证。

![Subscriptions 页面](docs/images/screenshot-subscriptions.webp)

> **服务条款提示：** 将 Claude Code 订阅用于 Claude Code 以外的应用程序请求，可能违反 [Anthropic 使用政策](https://www.anthropic.com/legal/aup)。请自行评估风险后使用此功能。

## ⚙️ 配置

### 磁盘配置（`~/.rialto/config.json`）

存储启动时的标量值和磁盘常驻对象。支持环境变量插值（`$VAR` / `${VAR}`）和 JSON5 注释。自动保留最近三个备份。

| 键 | 说明 |
|----|------|
| `APIKEY` | `/api/*` 的管理密钥，通过 `x-api-key` 或 `Authorization: Bearer` 发送。`/v1/*` 不接受 |
| `HOST` | 监听地址。默认 `127.0.0.1`；反向代理后端使用 `0.0.0.0`（需要 `APIKEY`）|
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access 团队域名。与 `ACCESS_AUD` 一起校验 `/api/*` 的 assertion |
| `ACCESS_AUD` | Access 应用的 AUD 标签。**两者都设置才会生效** |
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
| `image` | 图像相关任务（使用 Rialto 内置图像代理）|

### effort、层级与兜底

除了上面的场景触发器，路由器还会对每个请求做分级，并按顺序遍历兜底链：

- **分级信号** — `output_config.effort`（low/medium → `default`，high/xhigh/max → `longContext`），以及当 effort 缺失时从 `body.model` 解析出来的请求模型层级（opus → 重，sonnet/haiku → 轻）。显式的 low/medium effort 会抑制层级兜底，让调用方主动把默认的 opus 请求降级。
- **每场景兜底链** — 每个槽位都接受一个 `provider,model` 格式的有序兜底列表。路由器遍历 `[primary, ...fallbacks]`，挑选第一个同时满足"周窗口仍有余量"和"声明的上下文窗口足以容纳本次请求"的候选。
- **周维度排空守卫** — 当订阅型提供商的*周维度*用量越过线性排空目标时跳过（claude 看 `seven_day_opus` 或整体 `seven_day`，codex 看 `secondary`）。5h 与 codex primary 是*软*窗口，可以突发而不会触发切换。`Router.weeklyDrainMarginPct`（0..100，默认 0）允许用量在守卫触发前再多跑这么多个百分点 — 适合"宁愿把周窗口用满也不切换"的场景。
- **能力门** — 切换永远不会落到一个 `contextWindow` 容不下本次请求的模型上。未声明窗口的模型默认放行（unknown = allow，保守默认值）。
- **多账户均衡** — 当同一 Claude 提供商上启用了多个 SubAccount，会话路由器会挑选周维度余量最大（距离线性排空目标最远）的账户，并把同一会话内后续请求粘在该账户上。

路由决策会以结构化日志记录：发生切换时会输出 `{ from, to, scenario, marginPct, tokenCount, trace }`，所有候选都被拒绝时会输出 "dead chain" 警告。trace 中每个候选都标注了 `rate-limited` / `capability` / `malformed` / `kept` 之一，运营人员可以从中看出尝试了哪些候选、又为何被拒。

### 人格

*人格*是一段命名的系统提示片段，在场景判定之后，会被追加到每一个面向用户的请求里。借助它可以在不修改 Claude Code 本体的前提下，让 Claude Code 始终保持某种口吻、角色或工作守则。

- **人格库** — `Personas` 是磁盘 envelope 上的顶层数组。每个条目都带有一个稳定的 uuid `id`、显示用的 `name`（无需唯一）和正文 `prompt`。新装环境会附带一个小型的初始人格库；既有环境则保留磁盘上已经存在的内容。
- **当前激活** — 每个 Router 只能有一个激活的人格。当前激活的人格 uuid id 写在 `Router.persona` 上，并通过磁盘上的 `ActivePersona` envelope 键进行往返。`null` / 缺失 / 空字符串表示「无人格」。项目级与会话级的 Router 覆盖文件也接受 `Router.persona`。
- **注入方式** — 路由器解析完场景后，会把当前人格的 `prompt` 追加到带有 `cache_control` 的最后一个 system 块上（若没有则退回到最后一个字符串文本块）。这样人格就被收纳进缓存前缀的*内部*，既不会消耗额外的 cache 断点，又能在多次请求之间保持字节级稳定（保留 Anthropic 的 prompt cache）。当 `system` 为字符串 / 未定义时进行拼接；多块数组形式则原地修改。
- **场景例外** — `background` 场景会被排除：它跑的是标题生成等轻量内部任务，人格化的语气会污染这类输出。其它场景（default / think / longContext / webSearch / image）都会继承当前的人格。
- **与子代理交互** — 人格注入在 `<RIALTO-SUBAGENT-MODEL>` 标签处理*之后*执行，所以子代理的逐次系统内容不会被覆盖，而是与人格合成。

人格库管理在 **Personas** 页面（`/personas`），当前激活人格的切换在 **Router** 页面。「无人格」是默认的 no-op。

关于如何撰写高还原度的人格（结构模板、反模式列举、`think` 请求下的思考过程控制），请参见 [docs/guides/persona-authoring.md](docs/guides/persona-authoring.md)。

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
      "path": "/home/user/.rialto/plugins/my-transformer.js",
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
  "CUSTOM_ROUTER_PATH": "/home/user/.rialto/custom-router.js"
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
<RIALTO-SUBAGENT-MODEL>provider,model</RIALTO-SUBAGENT-MODEL>
请帮我分析这段代码...
```

## 📊 日志

- **服务器级日志**（pino）：`~/.rialto/logs/rialto-*.log` — HTTP 请求、API 调用、服务器事件。级别由 `LOG_LEVEL` 控制。
- **应用级日志**：`~/.rialto/rialto.log` — 路由决策和业务逻辑事件。

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
DATABASE_URL=postgres://postgres:password@postgres:5432/rialto
REDIS_URL=redis://redis:6379
```

```shell
bun run db:migrate
bun run dev         # Vite 开发服务器（端口 16175）
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
