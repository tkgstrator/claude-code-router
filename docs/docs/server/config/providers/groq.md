---
sidebar_position: 6
---

# Groq

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

**Transformer**: `groq` — adapts requests for the Groq API.

## Routing example

```json
{
  "Router": {
    "background": "groq,llama-3.3-70b-versatile"
  }
}
```
