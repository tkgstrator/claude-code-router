---
sidebar_position: 1
---

# OpenAI

## Chat Completions API

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

**Transformer**: `OpenAI` — adapts Anthropic-format requests to the OpenAI Chat Completions API.

## Codex (Responses API)

For models accessible via the OpenAI Responses API (`gpt-5-codex`, `gpt-5.1-codex-mini`):

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

**Transformer**: `openai-responses` — adapts requests/responses for the OpenAI Responses API (`/v1/responses`).

## ChatGPT Plus (Codex CLI credentials)

Route through ChatGPT Plus subscription using credentials from the [Codex CLI](https://github.com/openai/codex):

```json
{
  "name": "codex",
  "api_base_url": "https://chatgpt.com/backend-api/codex/responses",
  "api_key": "placeholder",
  "models": ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex"],
  "transformer": {
    "use": ["openai-responses", "codex-auth"]
  }
}
```

Requires `~/.codex/auth.json`. Run `codex` to authenticate. The `codex-auth` transformer reads the token and auto-refreshes it before expiry.

### Available ChatGPT Plus models

| Model         | Notes                |
|---------------|----------------------|
| gpt-5.5       | Latest, default      |
| gpt-5.4       | High capability      |
| gpt-5.3-codex | Coding-optimized     |

## Routing example

```json
{
  "Router": {
    "default": "openai,gpt-4o",
    "background": "openai,gpt-4o-mini",
    "think": "openai,o3"
  }
}
```
