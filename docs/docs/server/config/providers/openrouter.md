---
sidebar_position: 5
---

# OpenRouter

Access hundreds of models through a single API key.

```json
{
  "name": "openrouter",
  "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
  "api_key": "$OPENROUTER_API_KEY",
  "models": [
    "google/gemini-2.5-pro-preview",
    "anthropic/claude-sonnet-4",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.7-sonnet:thinking"
  ],
  "transformer": {
    "use": ["openrouter"]
  }
}
```

**Transformer**: `openrouter` — adapts requests for the OpenRouter API and supports provider routing parameters.

## Provider routing

Restrict which underlying providers OpenRouter uses for a specific model:

```json
{
  "transformer": {
    "use": ["openrouter"],
    "moonshotai/kimi-k2": {
      "use": [
        ["openrouter", { "provider": { "only": ["moonshotai/fp8"] } }]
      ]
    }
  }
}
```

See the [OpenRouter provider routing docs](https://openrouter.ai/docs/features/provider-routing) for full options.

## Web search

Append `:online` to the model name to enable web search:

```json
{
  "Router": {
    "webSearch": "openrouter,google/gemini-2.5-pro-preview:online"
  }
}
```

## Routing example

```json
{
  "Router": {
    "default": "openrouter,anthropic/claude-sonnet-4",
    "longContext": "openrouter,google/gemini-2.5-pro-preview",
    "think": "openrouter,anthropic/claude-3.7-sonnet:thinking"
  }
}
```
