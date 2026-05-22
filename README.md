[![](https://img.shields.io/badge/🇬🇧-English-000aff?style=flat)](README.md)
[![](https://img.shields.io/badge/🇯🇵-日本語-bc002d?style=flat)](README_ja.md)
[![](https://img.shields.io/badge/🇨🇳-中文版-ff0000?style=flat)](README_zh.md)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white)](https://discord.gg/rdftVMaUcS)
[![](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

<hr>

> A powerful proxy that routes Claude Code requests to any LLM provider — without changing your Claude Code setup.

## ✨ Features

- **Task-based routing** — assign different models to six built-in scenarios: `default`, `background`, `think` (Plan Mode), `longContext`, `webSearch`, and `image`.
- **Multi-provider support** — connect API-key providers (Anthropic, OpenAI, DeepSeek, Gemini, Groq, OpenRouter, …) or subscription-based providers (Claude Code OAuth, OpenAI Codex).
- **Subscription monitoring** — track rate-limit windows and compare actual API spend against subscription cost.
- **Usage & cost dashboard** — per-provider and per-model cost breakdown with daily cost charts.
- **Request history** — browse and replay past LLM requests.
- **Web management UI** — full browser-based configuration; no manual JSON editing required.
- **Transformer pipeline** — built-in and custom transformers adapt Anthropic-format requests to each provider's API.
- **Custom JavaScript router** — implement any routing logic beyond the six built-in scenarios.
- **Subagent model pinning** — direct individual subagents to a specific provider and model using an inline prompt tag.
- **Status line** — real-time CCR status display integrated into Claude Code's status bar.
- **Docker-first deployment** — single `docker compose up -d` with PostgreSQL and Redis included.

## 🖥️ Web UI

![Models page](docs/images/screenshot-models.webp)

The web UI (served on port **3456** by default) gives you full control over every aspect of the router:

| Page | Purpose |
|------|---------|
| **Models** | View enabled models, pricing, context window, and test connectivity |
| **Providers** | Add, edit, or remove API-key and subscription providers |
| **Router** | Assign models to each routing scenario |
| **Subscriptions** | Monitor rate-limit windows and subscription cost vs. API spend |
| **Usage** | API cost breakdown by provider and model with time-series charts |
| **History** | Browse past request logs |
| **Settings** | Configure host, port, proxy, logging, status line, and API key |

![Providers page](docs/images/screenshot-providers.webp)

![Router page](docs/images/screenshot-router.webp)

![Usage page](docs/images/screenshot-usage.webp)

## 🚀 Quick Start with Docker (Recommended)

Install [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/), then:

**Step 1 — Create a working directory and a minimal config file:**

```shell
mkdir -p ~/ccr ~/.claude-code-router
cd ~/ccr

cat > ~/.claude-code-router/config.json << 'EOF'
{
  "APIKEY": "your-secret-key"
}
EOF
```

> The `APIKEY` guards the web UI and the `/v1/*` proxy. If you omit it, one is generated on first boot and printed to the server console.

**Step 2 — Download `compose.yaml`:**

```shell
curl -fsSL https://raw.githubusercontent.com/musistudio/claude-code-router/main/compose.yaml -o compose.yaml
```

**Step 3 — (Optional) Store provider credentials in `.env`:**

```shell
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
ANTHROPIC_API_KEY=sk-ant-...
EOF
```

**Step 4 — Start the services:**

```shell
docker compose up -d
```

The server starts at `http://127.0.0.1:3456`. Open that URL in a browser, sign in with your `APIKEY`, and use the **Providers** and **Router** pages to finish configuration.

**Step 5 — Point Claude Code at the router:**

```shell
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=your-secret-key claude
```

Or set permanently in your shell profile:

```shell
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=your-secret-key
```

**View logs:**

```shell
docker compose logs -f
```

**Apply config changes:**

```shell
docker compose restart
```

## 🔌 Connecting Providers

### API key providers

On the **Providers** page, select any API-key provider (Anthropic, OpenAI, DeepSeek, Gemini, etc.), enter your API key, and save. Environment-variable interpolation (`$VAR`) is supported so you can keep secrets out of the config file.

### Subscription providers (Claude Code & Codex)

CCR can route through subscription-based providers without a per-call API key.

**Claude Code** — Open the **Providers** page → **Subscription** tab → **Connect**, then complete the OAuth flow. CCR stores and auto-refreshes the credentials.

**Codex (OpenAI)** — Browser-based login is not currently supported. Authentication is handled via credential file upload only.

![Subscriptions page](docs/images/screenshot-subscriptions.webp)

> **Terms of service notice:** Using a Claude Code subscription to serve requests from applications other than Claude Code may violate [Anthropic's usage policies](https://www.anthropic.com/legal/aup). Use this feature at your own discretion and risk.

## ⚙️ Configuration

### Disk envelope (`~/.claude-code-router/config.json`)

Boot-time scalars and disk-resident objects live here. Environment-variable interpolation (`$VAR` / `${VAR}`) and JSON5 comments are supported. The last three backups are kept automatically.

| Key | Description |
|-----|-------------|
| `APIKEY` | Secret key clients must send as `x-api-key` or `Authorization: Bearer` |
| `HOST` | Listen address. Defaults to `127.0.0.1`; set to `0.0.0.0` when behind a reverse proxy (requires `APIKEY`) |
| `PORT` | Listen port (default: `3456`) |
| `LOG` | `true` to enable log files |
| `LOG_LEVEL` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `PROXY_URL` | HTTP proxy for upstream API requests |
| `API_TIMEOUT_MS` | Upstream API call timeout in ms (default: `600000`) |
| `CLAUDE_PATH` | Path to the `claude` executable |
| `NON_INTERACTIVE_MODE` | Set `true` for Docker / CI environments to prevent stdin hangs |
| `CUSTOM_ROUTER_PATH` | Absolute path to a custom JavaScript router module |

### Providers, Models, and Router (database)

After the first boot, providers, models, and router slots are managed in PostgreSQL via the web UI or configuration API — not in `config.json`. On first boot, any `Providers` / `Router` keys found in `config.json` are migrated to the database automatically (one-shot, idempotent).

### Routing scenarios

Configure which model to use for each scenario on the **Router** page:

| Scenario | When it is used |
|----------|----------------|
| `default` | All requests not matched by another scenario |
| `background` | Lightweight background tasks |
| `think` | Reasoning-intensive tasks (Plan Mode) |
| `longContext` | Requests above the context threshold (default 60 000 tokens) |
| `webSearch` | Web search tasks (the model must support search natively) |
| `image` | Image-related tasks (uses CCR's built-in image agent) |

### Transformers

Transformers adapt Anthropic-format requests to each provider's wire format.

**Built-in transformers:**

| Transformer | Description |
|-------------|-------------|
| `Anthropic` | Pass-through for native Anthropic endpoints |
| `claude-code-credentials` | Use local Claude Code OAuth token (`~/.claude/.credentials.json`) with auto-refresh |
| `openai-responses` | OpenAI Responses API (`/v1/responses`) — for Codex models |
| `OpenAI` | Standard OpenAI Chat Completions API |
| `deepseek` | DeepSeek API |
| `gemini` | Google Gemini API |
| `openrouter` | OpenRouter API (supports `provider` routing parameter) |
| `groq` | Groq API |
| `maxtoken` | Override `max_tokens` (accepts `{ "max_tokens": N }` option) |
| `tooluse` | Optimize tool-call handling via `tool_choice` |
| `reasoning` | Handle `reasoning_content` field |
| `sampling` | Handle sampling fields (`temperature`, `top_p`, `top_k`, `repetition_penalty`) |
| `enhancetool` | Add error-tolerance to tool-call parameters (disables streaming tool calls) |
| `cleancache` | Strip `cache_control` from requests |
| `vertex-gemini` | Gemini via Vertex AI authentication |
| `gemini-cli` *(experimental)* | Gemini via Gemini CLI (unofficial) |
| `qwen-cli` *(experimental)* | qwen3-coder-plus via Qwen CLI (unofficial) |
| `rovo-cli` *(experimental)* | GPT-5 via Atlassian Rovo Dev CLI (unofficial) |

**Custom transformer plugins:**

Add your own transformer by loading a JavaScript module from the disk envelope:

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

**Transformer configuration examples:**

```json
{
  "name": "openrouter",
  "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
  "api_key": "$OPENROUTER_API_KEY",
  "models": ["google/gemini-2.5-pro", "anthropic/claude-sonnet-4"],
  "transformer": { "use": ["openrouter"] }
}
```

Model-specific transformer:

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

Transformer with options:

```json
{
  "transformer": {
    "use": [["maxtoken", { "max_tokens": 65536 }], "enhancetool"]
  }
}
```

### Custom JavaScript router

For routing logic beyond the six built-in scenarios, set `CUSTOM_ROUTER_PATH` in the disk envelope:

```json
{
  "CUSTOM_ROUTER_PATH": "/home/user/.claude-code-router/custom-router.js"
}
```

The module must export an `async` function that returns `"provider,model"` or `null` (fall through to default routing):

```javascript
module.exports = async function router(req, config) {
  const userMessage = req.body.messages.find(m => m.role === 'user')?.content;
  if (userMessage?.includes('explain this code')) {
    return 'openrouter,anthropic/claude-3.5-sonnet';
  }
  return null;
};
```

See `custom-router.example.js` in the repository root for a full example.

### Subagent routing

Pin a specific model for a subagent by prefixing its prompt with:

```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
Please help me analyze this code...
```

## 📊 Logging

- **Server-level logs** (pino): `~/.claude-code-router/logs/ccr-*.log` — HTTP requests, API calls, server events. Level controlled by `LOG_LEVEL`.
- **Application-level logs**: `~/.claude-code-router/claude-code-router.log` — routing decisions and business-logic events.

## 🛠️ Development

### Prerequisites

- Bun ≥ 1.1.0
- PostgreSQL
- Redis

The devcontainer (`.devcontainer/compose.yaml`) provides `postgres` and `redis` automatically.

### Setup

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
bun run dev         # Vite dev server on port 16173
```

### Build

```shell
bun run build       # Vite production build (SPA into dist/)
```

### Test

```shell
bun run test              # Unit and DB tests
bun run test:providers    # Provider integration tests
```

### Database tooling

| Script | Purpose |
|--------|---------|
| `bun run db:generate` | Regenerate Prisma client |
| `bun run db:migrate` | Create and apply a migration (development) |
| `bun run db:migrate:deploy` | Apply existing migrations (production / CI) |
| `bun run db:reset` | Drop and recreate the schema (destructive) |
| `bun run db:studio` | Open Prisma Studio |

Always go through Prisma migrations — never edit DDL directly.

### Price scraping

| Script | Purpose |
|--------|---------|
| `bun run scrape:openai-prices` | Scrape OpenAI model pricing |
| `bun run scrape:anthropic-prices` | Scrape Anthropic model pricing |
| `bun run scrape:google-prices` | Scrape Google / Gemini pricing |
| `bun run scrape:prices` | Scrape all of the above |

### Release

| Script | Purpose |
|--------|---------|
| `bun run release` | Build and publish the Docker image |
| `bun run release:docker` | Publish Docker image only |

## License

MIT — see `LICENSE`.
