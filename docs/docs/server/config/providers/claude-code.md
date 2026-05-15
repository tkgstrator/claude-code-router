---
sidebar_position: 3
---

# Claude (Claude Code credentials)

Use your existing Claude Code subscription without a separate Anthropic API key.

```json
{
  "name": "claude",
  "api_base_url": "https://api.anthropic.com/v1/messages",
  "api_key": "placeholder",
  "models": [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001"
  ],
  "transformer": {
    "use": ["claude-code-credentials"]
  }
}
```

**Transformer**: `claude-code-credentials` — reads `~/.claude/.credentials.json`, uses the OAuth token as the API key, and refreshes it automatically.

## Requirements

- Active Claude Code installation with OAuth credentials at `~/.claude/.credentials.json`
- With Docker, mount `~/.claude` into the container (done automatically via `compose.yaml`)

## Routing example

```json
{
  "Router": {
    "background": "claude,claude-haiku-4-5-20251001",
    "think": "claude,claude-sonnet-4-6"
  }
}
```
