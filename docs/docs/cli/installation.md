---
sidebar_position: 2
---

# Installation

## Docker (Recommended)

The recommended way to run Claude Code Router is via Docker Compose.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) >= 20.10
- [Docker Compose](https://docs.docker.com/compose/install/) >= 2.0
- Git

### Steps

1. **Clone the repository:**

   ```bash
   git clone https://github.com/musistudio/claude-code-router.git
   cd claude-code-router
   ```

2. **Create your config file:**

   ```bash
   mkdir -p ~/.claude-code-router
   cat > ~/.claude-code-router/config.json << 'EOF'
   {
     "APIKEY": "your-secret-key",
     "Providers": [
       {
         "name": "openai",
         "api_base_url": "https://api.openai.com/v1/chat/completions",
         "api_key": "$OPENAI_API_KEY",
         "models": ["gpt-4o"],
         "transformer": { "use": ["OpenAI"] }
       }
     ],
     "Router": { "default": "openai,gpt-4o" }
   }
   EOF
   ```

3. **(Optional) Create a `.env` file for API keys:**

   ```bash
   echo "OPENAI_API_KEY=sk-..." > .env
   ```

4. **Start the service:**

   ```bash
   docker compose up -d
   ```

   The router is now available at `http://127.0.0.1:3456`.

5. **Connect Claude Code to the router:**

   ```bash
   export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
   export ANTHROPIC_AUTH_TOKEN=your-secret-key
   claude
   ```

**Useful commands:**

```bash
docker compose logs -f     # Stream logs
docker compose restart     # Restart after config changes
docker compose down        # Stop the service
```

---

## Global CLI Install (Alternative)

Install Claude Code Router as a global CLI tool if you prefer not to use Docker.

### Prerequisites

- **Node.js**: >= 18.0.0 (or [Bun](https://bun.sh/) >= 1.0.0)
- An active Claude Code installation

### Install via Bun (recommended)

```bash
bun install -g @musistudio/claude-code-router
```

### Install via npm

```bash
npm install -g @musistudio/claude-code-router
```

### Install via pnpm

```bash
pnpm add -g @musistudio/claude-code-router
```

### Verify Installation

```bash
ccr --version
```

### Start the service

```bash
ccr start
ccr code      # Launch Claude Code through the router
```

## Next Steps

Once installed, proceed to [Quick Start](/docs/quick-start) to configure and start using the router.
