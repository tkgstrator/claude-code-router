---
sidebar_position: 2
---

# Google Gemini

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

**Transformer**: `gemini` — constructs the Gemini-specific URL (`{model}:streamGenerateContent`) and sets the `x-goog-api-key` header.

> The `api_base_url` must end with a trailing `/`. The transformer appends the model name and action automatically.

## Available models (as of 2025)

| Model            | Notes           |
|------------------|-----------------|
| gemini-2.5-flash | Fast, default   |
| gemini-2.5-pro   | High capability |

Older models (`gemini-2.0-flash`, `gemini-1.5-pro`) may no longer be available for new API keys.

## Routing example

```json
{
  "Router": {
    "default": "gemini,gemini-2.5-flash",
    "longContext": "gemini,gemini-2.5-pro",
    "webSearch": "gemini,gemini-2.5-flash"
  }
}
```
