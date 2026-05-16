![](blog/images/claude-code-router-img.png)

[![](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-%E4%B8%AD%E6%96%87%E7%89%88-ff0000?style=flat)](README_zh.md)
[![](https://img.shields.io/badge/%F0%9F%87%AF%F0%9F%87%B5-%E6%97%A5%E6%9C%AC%E8%AA%9E-white?style=flat)](README_ja.md)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white)](https://discord.gg/rdftVMaUcS)
[![](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

<hr>

![](blog/images/sponsors/glm-en.jpg)
> This project is sponsored by Z.ai, supporting us with their GLM CODING PLAN.

> GLM CODING PLAN is a subscription service designed for AI coding, starting at just $10/month. It provides access to their flagship GLM-4.7 & （GLM-5 Only Available  for Pro Users）model across 10+ popular AI coding tools (Claude Code, Cline, Roo Code, etc.), offering developers top-tier, fast, and stable coding experiences.

> Get 10% OFF GLM CODING PLAN：https://z.ai/subscribe?ic=8JVLJQFSKB  

> [Progressive Disclosure of Agent Tools from the Perspective of CLI Tool Style](/blog/en/progressive-disclosure-of-agent-tools-from-the-perspective-of-cli-tool-style.md)

> A powerful tool to route Claude Code requests to different models and customize any request.

![](blog/images/claude-code.png)

## Features

Claude Code Router sits between Claude Code and the LLM, so you can route every request to whichever model fits best — without touching your Claude Code setup.

- **Automatic routing by task type** — Background tasks go to a fast, cheap model; reasoning tasks to a powerful one; long documents to a high-context model. Configure once, works automatically.
- **Any provider** — OpenAI, Gemini, DeepSeek, OpenRouter, Ollama (local), Groq, and more. Mix providers freely.
- **ChatGPT Plus (Codex)** — Route through your ChatGPT Plus subscription via Codex CLI credentials, or use gpt-5.5 / gpt-5.4 / gpt-5.3-codex via OpenAI API key.
- **No extra API key** — Use your existing Claude Code sign-in as a backend via the `claude-code-credentials` transformer.
- **Switch models mid-session** — Type `/model gemini,gemini-3.1-pro-preview` inside Claude Code to change the model on the fly.
- **Config UI & CLI** — `ccr ui` opens a browser editor; `ccr model` handles everything from the terminal.
- **GitHub Actions** — Works in CI/CD pipelines with `NON_INTERACTIVE_MODE`.
- **Custom transformers** — Write plugins to support any provider or modify request/response behavior.

## 🤖 Available Models

The following providers and models are configured by default. Edit `~/.claude-code-router/config.json` to add or change providers.

### Codex — ChatGPT Plus via Codex CLI credentials
Requires `~/.codex/auth.json`. Run `codex` to authenticate.

| Model          | Used for                            |
|----------------|-------------------------------------|
| gpt-5.5        | default / think / longContext       |
| gpt-5.4        | High capability                     |
| gpt-5.3-codex  | Coding-optimized                    |

### OpenAI — `$OPENAI_API_KEY`

| Model          | Notes              |
|----------------|--------------------|
| gpt-5.5        | Latest, high capability |
| gpt-5.4        | High capability    |
| gpt-5.3-codex  | Coding-optimized   |
| gpt-4.1        | High capability    |
| gpt-4.1-mini   | Fast, economical   |
| gpt-4o         | High capability    |
| gpt-4o-mini    | Fast, economical   |

### Gemini — `$GEMINI_API_KEY`

| Model                 | Notes           |
|-----------------------|-----------------|
| gemini-3.1-pro-preview | Latest, high capability |
| gemini-2.5-flash      | Fast, default   |
| gemini-2.5-pro        | High capability |

### Claude — Claude Code OAuth credentials
Requires `~/.claude/.credentials.json`. Sign in via Claude Code.

| Model                     | Used for        |
|---------------------------|-----------------|
| claude-opus-4-7           | High capability |
| claude-sonnet-4-6         | Balanced        |
| claude-haiku-4-5-20251001 | background tasks |

### Default Routing

| Scenario    | Provider, Model                  |
|-------------|----------------------------------|
| default     | codex, gpt-5.5                   |
| background  | claude, claude-haiku-4-5-20251001 |
| think       | codex, gpt-5.5                   |
| longContext | codex, gpt-5.5                   |

To route to a specific model, use the `provider,model` format in the `/model` command or request body:

```
/model openai,gpt-4o-mini
/model gemini,gemini-2.5-flash
/model claude,claude-haiku-4-5-20251001
```

## 🚀 Getting Started

### 1. Quick Start with Docker

The recommended way to run Claude Code Router is via Docker Compose. This requires [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/). No repository clone is needed — the image is published to Docker Hub.

**Step 1 — Create a working directory and config file:**

```shell
mkdir -p ~/ccr ~/.claude-code-router
cd ~/ccr

cat > ~/.claude-code-router/config.json << 'EOF'
{
  "APIKEY": "your-secret-key",
  "Providers": [
    {
      "name": "openai",
      "api_base_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "transformer": { "use": ["OpenAI"] }
    }
  ],
  "Router": {
    "default": "openai,gpt-4o-mini"
  }
}
EOF
```

**Step 2 — Download `compose.yaml`:**

```shell
curl -fsSL https://raw.githubusercontent.com/musistudio/claude-code-router/main/compose.yaml -o compose.yaml
```

**Step 3 — (Optional) Create a `.env` file for API keys:**

```shell
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
EOF
```

**Step 4 — Start the service:**

```shell
docker compose up -d
```

The router is now available at `http://127.0.0.1:3456`.

**Step 5 — Configure Claude Code to use the router:**

```shell
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=your-secret-key claude
```

Or set permanently in your shell profile:

```shell
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=your-secret-key
```

> **Note**: After modifying `config.json`, restart the container for changes to take effect:
>
> ```shell
> docker compose restart
> ```

**View logs:**

```shell
docker compose logs -f
```

---

### Alternative: Global CLI Install

If you prefer a non-Docker setup, install Claude Code Router as a global CLI tool.

First, ensure you have [Claude Code](https://docs.anthropic.com/en/docs/claude-code/quickstart) installed:

```shell
npm install -g @anthropic-ai/claude-code
```

Then, install Claude Code Router:

```shell
# Via Bun (recommended — the project runs on Bun internally)
bun install -g @musistudio/claude-code-router

# Via npm
npm install -g @musistudio/claude-code-router
```

Start Claude Code using the router:

```shell
ccr code
```

> **Note**: After modifying the configuration file, restart the service:
>
> ```shell
> ccr restart
> ```

---

### 2. Configuration

Claude Code Router now uses a hybrid store:

- `Providers`, `Router`, and model bindings live in **Postgres** (via Prisma).
- Boot-time envelope keys (HOST/PORT/APIKEY/LOG_LEVEL/etc.) stay in `~/.claude-code-router/config.json`.
- On the first start after upgrading, the server lifts any `Providers` / `Router` it finds on disk into the database and rewrites the file as envelope-only. The pre-migration copy is kept as `config.json.<timestamp>.bak`. If the database already holds rows AND `config.json` still carries the legacy keys (e.g. after a manual restore), the migration refuses to run and asks you to resolve the conflict manually.

Set `DATABASE_URL` in `.env` (the `.devcontainer/compose.yaml` brings up a local `postgres` service):

```bash
DATABASE_URL=postgres://postgres:password@postgres:5432/ccr
```

For the schema and migration tooling, run inside `packages/server`:

```bash
bun run db:generate         # regenerate the Prisma client
bun run db:migrate           # create + apply a new migration (dev)
bun run db:migrate:deploy    # apply existing migrations (prod / CI)
bun run db:reset             # drop and recreate the schema (destructive)
bun run db:studio            # open Prisma Studio
```

See `config.example.json` for envelope reference fields:

| Field | Default | Description |
|-------|---------|-------------|
| `LOG` | `true` | Enable/disable log files |
| `LOG_LEVEL` | `"debug"` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `PROXY_URL` | — | HTTP proxy for all API requests |
| `APIKEY` | — | Secret key clients must send in `x-api-key` or `Authorization` |
| `HOST` | `127.0.0.1` | Listen address. Forced to `127.0.0.1` when `APIKEY` is unset |
| `NON_INTERACTIVE_MODE` | `false` | Set `true` for Docker / CI / GitHub Actions |
| `API_TIMEOUT_MS` | — | Timeout for upstream API calls (ms) |

> Providers and Router are managed via the Web UI (`ccr ui`) or `/api/config`; they no longer belong in `config.json` after the first boot.

API keys support environment variable interpolation (`$VAR_NAME` or `${VAR_NAME}`). With Docker Compose, place keys in a `.env` file at the project root:

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

Minimal example:

```json
{
  "Providers": [
    {
      "name": "openai",
      "api_base_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "transformer": { "use": ["OpenAI"] }
    }
  ],
  "Router": {
    "default": "openai,gpt-4o",
    "background": "openai,gpt-4o-mini"
  }
}
```

For per-provider configuration details, see the [Provider guides](#providers).

### 3. Start Claude Code

```shell
ccr code
```

After editing `config.json`, restart the service for changes to take effect:

```shell
ccr restart
```

### 4. Config UI

```shell
ccr ui
```

Opens a browser-based editor for `config.json`.

![UI](/blog/images/ui.png)

### 5. CLI Model Management

```shell
ccr model
```
![](blog/images/models.gif)

An interactive terminal UI to view and change your provider/model setup without editing JSON. You can switch the model for any routing scenario (default, background, think, longContext…), add models to existing providers, or create a new provider from scratch.

### 6. Presets Management

Presets allow you to save, share, and reuse configurations easily. You can export your current configuration as a preset and install presets from files or URLs.

```shell
# Export current configuration as a preset
ccr preset export my-preset

# Export with metadata
ccr preset export my-preset --description "My OpenAI config" --author "Your Name" --tags "openai,production"

# Install a preset from local directory
ccr preset install /path/to/preset

# List all installed presets
ccr preset list

# Show preset information
ccr preset info my-preset

# Delete a preset
ccr preset delete my-preset
```

API keys are automatically redacted on export (`{{field}}` placeholders) and prompted for on install. Presets are stored in `~/.claude-code-router/presets/<name>/manifest.json`.

### 7. Activate Command

Point your shell (and any Agent SDK apps) at the router without using `ccr code`:

```shell
eval "$(ccr activate)"
```

This sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and a few other environment variables so that `claude` and Anthropic SDK apps route through CCR automatically.

To persist across sessions, add the line to your `~/.zshrc` or `~/.bashrc`. The router must be running (`ccr start`) for the variables to have any effect.

#### Providers

Each provider entry needs `name`, `api_base_url`, `api_key`, `models`, and optionally a `transformer`.

Per-provider configuration guides:
- [OpenAI](https://musistudio.github.io/claude-code-router/docs/config/providers/openai) — Chat Completions, Responses API (Codex), ChatGPT Plus
- [Google Gemini](https://musistudio.github.io/claude-code-router/docs/config/providers/gemini)
- [Claude (Claude Code credentials)](https://musistudio.github.io/claude-code-router/docs/config/providers/claude-code)
- [DeepSeek](https://musistudio.github.io/claude-code-router/docs/config/providers/deepseek)
- [OpenRouter](https://musistudio.github.io/claude-code-router/docs/config/providers/openrouter)
- [Groq](https://musistudio.github.io/claude-code-router/docs/config/providers/groq)
- [Ollama (local)](https://musistudio.github.io/claude-code-router/docs/config/providers/ollama)

#### Transformers

Transformers adapt Anthropic-format requests to each provider’s API. Built-in transformers:

| Transformer | Use for |
|-------------|---------|
| `OpenAI` | OpenAI Chat Completions |
| `openai-responses` | OpenAI Responses API (Codex) |
| `claude-code-credentials` | Anthropic via Claude Code OAuth token |
| `gemini` | Google Gemini |
| `deepseek` | DeepSeek |
| `openrouter` | OpenRouter (supports provider routing params) |
| `groq` | Groq |
| `maxtoken` | Override `max_tokens` |
| `tooluse` | Optimize tool calling via `tool_choice` |
| `reasoning` | Handle `reasoning_content` field |
| `enhancetool` | Error-tolerant tool call parsing (disables streaming) |
| `cleancache` | Strip `cache_control` from requests |
| `vertex-gemini` | Gemini via Vertex AI auth |
| `sampling` | Pass `temperature`, `top_p`, `top_k`, `repetition_penalty` |

Community transformers: [gemini-cli](https://gist.github.com/musistudio/1c13a65f35916a7ab690649d3df8d1cd), [qwen-cli](https://gist.github.com/musistudio/f5a67841ced39912fd99e42200d5ca8b), [chutes-glm](https://gist.github.com/vitobotta/2be3f33722e05e8d4f9d2b0138b8c863), [rovo-cli](https://gist.github.com/SaseQ/c2a20a38b11276537ec5332d1f7a5e53)

Custom transformers are loaded via the `transformers` array in `config.json`:
```json
{ "transformers": [{ "path": "/path/to/my-transformer.js" }] }
```

#### Router

The `Router` object maps scenarios to `provider,model` strings:

| Key | Description |
|-----|-------------|
| `default` | General tasks |
| `background` | Lightweight background tasks |
| `think` | Reasoning / Plan Mode |
| `longContext` | Long context (default threshold: 60 000 tokens) |
| `longContextThreshold` | Custom token threshold for `longContext` |
| `webSearch` | Web search (model must support it; append `:online` for OpenRouter) |
| `image` | Image tasks via CCR’s built-in agent |

Switch models on the fly: `/model provider,model` — e.g. `/model openrouter,anthropic/claude-3.5-sonnet`

#### Custom Router

Set `CUSTOM_ROUTER_PATH` in `config.json` to load a JS module that returns `"provider,model"` or `null`. See `custom-router.example.js` for a working template.

##### Subagent Routing

Prefix subagent prompts with `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` to pin a specific model:

```
<CCR-SUBAGENT-MODEL>openrouter,anthropic/claude-3.5-sonnet</CCR-SUBAGENT-MODEL>
Please help me analyze this code snippet...
```

## Status Line (Beta)
To better monitor the status of claude-code-router at runtime, version v1.0.40 includes a built-in statusline tool, which you can enable in the UI.
![statusline-config.png](/blog/images/statusline-config.png)

The effect is as follows:
![statusline](/blog/images/statusline.png)

## 🤖 GitHub Actions

Integrate Claude Code Router into your CI/CD pipeline. After setting up [Claude Code Actions](https://docs.anthropic.com/en/docs/claude-code/github-actions), modify your `.github/workflows/claude.yaml` to use the router:

```yaml
name: Claude Code

on:
  issue_comment:
    types: [created]
  # ... other triggers

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      # ... other conditions
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Prepare Environment
        run: |
          curl -fsSL https://bun.sh/install | bash
          mkdir -p $HOME/.claude-code-router
          cat << 'EOF' > $HOME/.claude-code-router/config.json
          {
            "log": true,
            "NON_INTERACTIVE_MODE": true,
            "OPENAI_API_KEY": "${{ secrets.OPENAI_API_KEY }}",
            "OPENAI_BASE_URL": "https://api.deepseek.com",
            "OPENAI_MODEL": "deepseek-chat"
          }
          EOF
        shell: bash

      - name: Start Claude Code Router
        run: |
          nohup ~/.bun/bin/bunx @musistudio/claude-code-router@latest start &
        shell: bash

      - name: Run Claude Code
        id: claude
        uses: anthropics/claude-code-action@beta
        env:
          ANTHROPIC_BASE_URL: http://localhost:3456
        with:
          anthropic_api_key: "any-string-is-ok"
```

> **Note**: When running in GitHub Actions or other automation environments, make sure to set `"NON_INTERACTIVE_MODE": true` in your configuration to prevent the process from hanging due to stdin handling issues.

This setup allows for interesting automations, like running tasks during off-peak hours to reduce API costs.

## 📝 Further Reading

- [Project Motivation and How It Works](blog/en/project-motivation-and-how-it-works.md)
- [Maybe We Can Do More with the Router](blog/en/maybe-we-can-do-more-with-the-route.md)
- [GLM-4.6 Supports Reasoning and Interleaved Thinking](blog/en/glm-4.6-supports-reasoning.md)

## ❤️ Support & Sponsoring

If you find this project helpful, please consider sponsoring its development. Your support is greatly appreciated!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/F1F31GN2GM)

[Paypal](https://paypal.me/musistudio1999)

<table>
  <tr>
    <td><img src="/blog/images/alipay.jpg" width="200" alt="Alipay" /></td>
    <td><img src="/blog/images/wechat.jpg" width="200" alt="WeChat Pay" /></td>
  </tr>
</table>

### Our Sponsors

A huge thank you to all our sponsors for their generous support!


- [AIHubmix](https://aihubmix.com/)
- [BurnCloud](https://ai.burncloud.com)
- [302.AI](https://share.302.ai/ZGVF9w)
- [Z智谱](https://www.bigmodel.cn/claude-code?ic=FPF9IVAGFJ)
- @Simon Leischnig
- [@duanshuaimin](https://github.com/duanshuaimin)
- [@vrgitadmin](https://github.com/vrgitadmin)
- @\*o
- [@ceilwoo](https://github.com/ceilwoo)
- @\*说
- @\*更
- @K\*g
- @R\*R
- [@bobleer](https://github.com/bobleer)
- @\*苗
- @\*划
- [@Clarence-pan](https://github.com/Clarence-pan)
- [@carter003](https://github.com/carter003)
- @S\*r
- @\*晖
- @\*敏
- @Z\*z
- @\*然
- [@cluic](https://github.com/cluic)
- @\*苗
- [@PromptExpert](https://github.com/PromptExpert)
- @\*应
- [@yusnake](https://github.com/yusnake)
- @\*飞
- @董\*
- @\*汀
- @\*涯
- @\*:-）
- @\*\*磊
- @\*琢
- @\*成
- @Z\*o
- @\*琨
- [@congzhangzh](https://github.com/congzhangzh)
- @\*\_
- @Z\*m
- @*鑫
- @c\*y
- @\*昕
- [@witsice](https://github.com/witsice)
- @b\*g
- @\*亿
- @\*辉
- @JACK
- @\*光
- @W\*l
- [@kesku](https://github.com/kesku)
- [@biguncle](https://github.com/biguncle)
- @二吉吉
- @a\*g
- @\*林
- @\*咸
- @\*明
- @S\*y
- @f\*o
- @\*智
- @F\*t
- @r\*c
- [@qierkang](http://github.com/qierkang)
- @\*军
- [@snrise-z](http://github.com/snrise-z)
- @\*王
- [@greatheart1000](http://github.com/greatheart1000)
- @\*王
- @zcutlip
- [@Peng-YM](http://github.com/Peng-YM)
- @\*更
- @\*.
- @F\*t
- @\*政
- @\*铭
- @\*叶
- @七\*o
- @\*青
- @\*\*晨
- @\*远
- @\*霄
- @\*\*吉
- @\*\*飞
- @\*\*驰
- @x\*g
- @\*\*东
- @\*落
- @哆\*k
- @\*涛
- [@苗大](https://github.com/WitMiao)
- @\*呢
- @\d*u
- @crizcraig
- s\*s
- \*火
- \*勤
- \*\*锟
- \*涛
- \*\*明
- \*知
- \*语
- \*瓜


(If your name is masked, please contact me via my homepage email to update it with your GitHub username.)
