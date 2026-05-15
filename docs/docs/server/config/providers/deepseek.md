---
sidebar_position: 4
---

# DeepSeek

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

**Transformers**:
- `deepseek` — adapts requests for the DeepSeek API
- `tooluse` (model-specific) — optimizes tool usage via `tool_choice` for `deepseek-chat`

## Volcengine (DeepSeek hosted on ByteDance)

```json
{
  "name": "volcengine",
  "api_base_url": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "api_key": "$VOLCENGINE_API_KEY",
  "models": ["deepseek-v3-250324", "deepseek-r1-250528"],
  "transformer": {
    "use": ["deepseek"]
  }
}
```

## Routing example

```json
{
  "Router": {
    "default": "deepseek,deepseek-chat",
    "think": "deepseek,deepseek-reasoner"
  }
}
```
