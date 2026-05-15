---
sidebar_position: 2
---

# Providers Configuration

The `Providers` array defines the LLM backends that Claude Code Router can route requests to.

## Provider Object Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the provider |
| `api_base_url` | string | Yes | Full API endpoint URL (including path) |
| `api_key` | string | Yes | API authentication key. Supports `$ENV_VAR` interpolation |
| `models` | string[] | Yes | List of model names available from this provider |
| `transformer` | object | No | Transformer configuration for request/response adaptation |

## Model Selection Format

When specifying a model in `Router` or `/model` command, use:

```
{provider-name},{model-name}
```

Example: `openai,gpt-4o` or `deepseek,deepseek-chat`

## Provider Examples

### OpenAI

```json
{
  "name": "openai",
  "api_base_url": "https://api.openai.com/v1/chat/completions",
  "api_key": "$OPENAI_API_KEY",
  "models": ["gpt-4o", "gpt-4o-mini", "o4-mini", "o3"],
  "transformer": {
    "use": ["OpenAI"]
  }
}
```

### OpenAI Responses API (Codex)

Use the `openai-responses` transformer for models accessible via the Responses API:

```json
{
  "name": "codex",
  "api_base_url": "https://api.openai.com/v1/responses",
  "api_key": "$OPENAI_API_KEY",
  "models": ["gpt-5.1-codex-mini", "gpt-5-codex"],
  "transformer": {
    "use": ["openai-responses"]
  }
}
```

### Claude Code (OAuth Token)

Use your existing Claude Code subscription without a separate API key:

```json
{
  "name": "claude-code",
  "api_base_url": "https://api.anthropic.com/v1/messages",
  "api_key": "placeholder",
  "models": ["claude-opus-4-5", "claude-sonnet-4-5"],
  "transformer": {
    "use": ["claude-code-credentials"]
  }
}
```

Requires an active Claude Code installation with OAuth credentials at `~/.claude/.credentials.json`.
With Docker, mount `~/.claude` into the container (done automatically via `compose.yaml`).

### DeepSeek

```json
{
  "name": "deepseek",
  "api_base_url": "https://api.deepseek.com/chat/completions",
  "api_key": "$DEEPSEEK_API_KEY",
  "models": ["deepseek-chat", "deepseek-reasoner"],
  "transformer": {
    "use": ["deepseek"],
    "deepseek-chat": {
      "use": ["tooluse"]
    }
  }
}
```

### Gemini

```json
{
  "name": "gemini",
  "api_base_url": "https://generativelanguage.googleapis.com/v1beta/models/",
  "api_key": "$GEMINI_API_KEY",
  "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
  "transformer": {
    "use": ["gemini"]
  }
}
```

### OpenRouter

```json
{
  "name": "openrouter",
  "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
  "api_key": "$OPENROUTER_API_KEY",
  "models": [
    "google/gemini-2.5-pro-preview",
    "anthropic/claude-sonnet-4",
    "anthropic/claude-3.5-sonnet"
  ],
  "transformer": {
    "use": ["openrouter"]
  }
}
```

### Groq

```json
{
  "name": "groq",
  "api_base_url": "https://api.groq.com/openai/v1/chat/completions",
  "api_key": "$GROQ_API_KEY",
  "models": ["llama-3.3-70b-versatile"],
  "transformer": {
    "use": ["groq"]
  }
}
```

### Ollama (Local)

```json
{
  "name": "ollama",
  "api_base_url": "http://localhost:11434/v1/chat/completions",
  "api_key": "ollama",
  "models": ["qwen2.5-coder:latest"]
}
```

> **Note when using Docker**: Ollama running on the host is accessible via `http://host.docker.internal:11434` instead of `localhost`.

## Transformer Configuration

The `transformer` object in a provider config controls how requests and responses are adapted.

### Global transformer (all models)

```json
"transformer": {
  "use": ["deepseek"]
}
```

### Model-specific transformer

```json
"transformer": {
  "use": ["deepseek"],
  "deepseek-chat": {
    "use": ["tooluse"]
  }
}
```

### Transformer with options

```json
"transformer": {
  "use": [
    ["maxtoken", { "max_tokens": 65536 }],
    "enhancetool"
  ]
}
```

## Environment Variable Interpolation

API keys can be referenced from environment variables using `$VAR_NAME` or `${VAR_NAME}`:

```json
{
  "api_key": "$OPENAI_API_KEY"
}
```

With Docker Compose, define your keys in a `.env` file at the project root. They are automatically injected into the container:

```bash
# .env
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

## Next Steps

- [Routing Configuration](/docs/config/routing) — Configure how requests are routed to providers
- [Transformers](/docs/config/transformers) — Learn about available transformers
