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

## ✨ Features

- **Model Routing**: Route requests to different models based on your needs (e.g., background tasks, thinking, long context).
- **Multi-Provider Support**: Supports various model providers like OpenRouter, DeepSeek, Ollama, Gemini, Volcengine, and SiliconFlow.
- **Request/Response Transformation**: Customize requests and responses for different providers using transformers.
- **Dynamic Model Switching**: Switch models on-the-fly within Claude Code using the `/model` command.
- **CLI Model Management**: Manage models and providers directly from the terminal with `ccr model`.
- **GitHub Actions Integration**: Trigger Claude Code tasks in your GitHub workflows.
- **Plugin System**: Extend functionality with custom transformers.
- **Claude Code Subscription**: Use your existing Claude Code OAuth token as a backend via the `claude-code-credentials` transformer — no separate API key needed.
- **OpenAI Codex Support**: Route Claude Code requests to OpenAI's Codex coding agent (`gpt-5-codex`, `gpt-5.1-codex-mini`) via the `openai-responses` transformer using your OpenAI API key.

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

Create and configure `~/.claude-code-router/config.json`. See `config.example.json` for a full reference.

Key top-level fields:

| Field | Default | Description |
|-------|---------|-------------|
| `Providers` | — | List of LLM backend configurations |
| `Router` | — | Routing rules (default, background, think, longContext…) |
| `LOG` | `true` | Enable/disable log files |
| `LOG_LEVEL` | `"debug"` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `PROXY_URL` | — | HTTP proxy for all API requests |
| `APIKEY` | — | Secret key clients must send in `x-api-key` or `Authorization` |
| `HOST` | `127.0.0.1` | Listen address. Forced to `127.0.0.1` when `APIKEY` is unset |
| `NON_INTERACTIVE_MODE` | `false` | Set `true` for Docker / CI / GitHub Actions |
| `API_TIMEOUT_MS` | — | Timeout for upstream API calls (ms) |

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

### 3. Running Claude Code with the Router (CLI mode)

Start Claude Code using the router:

```shell
ccr code
```

> **Note**: After modifying the configuration file, you need to restart the service for the changes to take effect:
>
> ```shell
> ccr restart
> ```

### 4. UI Mode

For a more intuitive experience, you can use the UI mode to manage your configuration:

```shell
ccr ui
```

This will open a web-based interface where you can easily view and edit your `config.json` file.

![UI](/blog/images/ui.png)

### 5. CLI Model Management

For users who prefer terminal-based workflows, you can use the interactive CLI model selector:

```shell
ccr model
```
![](blog/images/models.gif)

This command provides an interactive interface to:

- View current configuration:
- See all configured models (default, background, think, longContext, webSearch, image)
- Switch models: Quickly change which model is used for each router type
- Add new models: Add models to existing providers
- Create new providers: Set up complete provider configurations including:
   - Provider name and API endpoint
   - API key
   - Available models
   - Transformer configuration with support for:
     - Multiple transformers (openrouter, deepseek, gemini, etc.)
     - Transformer options (e.g., maxtoken with custom limits)
     - Provider-specific routing (e.g., OpenRouter provider preferences)

The CLI tool validates all inputs and provides helpful prompts to guide you through the configuration process, making it easy to manage complex setups without editing JSON files manually.

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

**Preset Features:**
- **Export**: Save your current configuration as a preset directory (with manifest.json)
- **Install**: Install presets from local directories
- **Sensitive Data Handling**: API keys and other sensitive data are automatically sanitized during export (marked as `{{field}}` placeholders)
- **Dynamic Configuration**: Presets can include input schemas for collecting required information during installation
- **Version Control**: Each preset includes version metadata for tracking updates

**Preset File Structure:**
```
~/.claude-code-router/presets/
├── my-preset/
│   └── manifest.json    # Contains configuration and metadata
```

### 7. Activate Command (Environment Variables Setup)

The `activate` command allows you to set up environment variables globally in your shell, enabling you to use the `claude` command directly or integrate Claude Code Router with applications built using the Agent SDK.

To activate the environment variables, run:

```shell
eval "$(ccr activate)"
```

This command outputs the necessary environment variables in shell-friendly format, which are then set in your current shell session. After activation, you can:

- **Use `claude` command directly**: Run `claude` commands without needing to use `ccr code`. The `claude` command will automatically route requests through Claude Code Router.
- **Integrate with Agent SDK applications**: Applications built with the Anthropic Agent SDK will automatically use the configured router and models.

The `activate` command sets the following environment variables:

- `ANTHROPIC_AUTH_TOKEN`: API key from your configuration
- `ANTHROPIC_BASE_URL`: The local router endpoint (default: `http://127.0.0.1:3456`)
- `NO_PROXY`: Set to `127.0.0.1` to prevent proxy interference
- `DISABLE_TELEMETRY`: Disables telemetry
- `DISABLE_COST_WARNINGS`: Disables cost warnings
- `API_TIMEOUT_MS`: API timeout from your configuration

> **Note**: Make sure the Claude Code Router service is running (`ccr start`) before using the activated environment variables. The environment variables are only valid for the current shell session. To make them persistent, you can add `eval "$(ccr activate)"` to your shell configuration file (e.g., `~/.zshrc` or `~/.bashrc`).

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
