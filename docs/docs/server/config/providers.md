---
sidebar_position: 2
---

# Providers

The `Providers` array defines the LLM backends that Claude Code Router can route requests to.

## Provider object fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the provider |
| `api_base_url` | string | Yes | Full API endpoint URL |
| `api_key` | string | Yes | API key. Supports `$ENV_VAR` interpolation |
| `models` | string[] | Yes | Model names available from this provider |
| `transformer` | object | No | Request/response transformation config |

## Model selection format

Use `provider,model` when specifying a model in `Router` config or the `/model` command:

```
openai,gpt-4o
gemini,gemini-2.5-flash
```

## Provider guides

- [OpenAI](./providers/openai) — Chat Completions, Responses API (Codex), ChatGPT Plus
- [Google Gemini](./providers/gemini)
- [Claude (Claude Code credentials)](./providers/claude-code)
- [DeepSeek](./providers/deepseek)
- [OpenRouter](./providers/openrouter)
- [Groq](./providers/groq)
- [Ollama (local)](./providers/ollama)

## Environment variable interpolation

API keys can be referenced from environment variables using `$VAR_NAME` or `${VAR_NAME}`:

```json
{
  "api_key": "$OPENAI_API_KEY"
}
```

With Docker Compose, define keys in a `.env` file at the project root:

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

## Next steps

- [Routing Configuration](./routing) — configure how requests are routed to providers
- [Transformers](./transformers) — available built-in transformers
