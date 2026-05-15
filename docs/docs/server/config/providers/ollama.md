---
sidebar_position: 7
---

# Ollama (local)

Run models locally with [Ollama](https://ollama.com). No transformer needed — Ollama's API is OpenAI-compatible.

```json
{
  "name": "ollama",
  "api_base_url": "http://localhost:11434/v1/chat/completions",
  "api_key": "ollama",
  "models": ["qwen2.5-coder:latest"]
}
```

> **Docker**: Ollama running on the host is accessible at `http://host.docker.internal:11434` instead of `localhost`.

## Routing example

```json
{
  "Router": {
    "background": "ollama,qwen2.5-coder:latest"
  }
}
```
