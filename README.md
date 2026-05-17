# Claude Code Router

Route Claude Code requests to any LLM provider without changing your Claude
Code setup. Claude Code Router (CCR) sits between Claude Code and the upstream
model, applying task-based routing and per-provider request/response
transformations.

The npm package is published as `@musistudio/claude-code-router` and installs
the `ccr` command-line tool.

## Features

- Task-based routing: distinct models for default, background, think,
  longContext, webSearch, and image scenarios.
- Multi-provider support through pluggable transformers (Anthropic, OpenAI,
  Gemini, DeepSeek, OpenRouter, Groq, and more).
- Switch the model mid-session from inside Claude Code using the
  `provider,model` format.
- Subagent model pinning via an inline prompt tag.
- Custom JavaScript router and custom transformer plugins.
- Web management UI and a full `ccr` CLI.
- Preset system to export, share, and install configurations (sensitive
  fields are redacted on export).
- Recurring usage-capture job backed by BullMQ and Redis.

## Architecture

CCR is a Bun monorepo (`workspaces: ["packages/*"]`) plus a consolidated
application at the repository root.

### Consolidated app (repository root)

- `src/` — React web UI (`src/app`, `src/components`, `src/assets`).
- `src/index.ts` — Hono server entry point.
- `src/api/<path>/route.ts` — backend routes; one Hono sub-app per file,
  mounted in `src/index.ts`.
- `src/api/v1/route.ts` — the native `/v1/*` LLM proxy that drives the
  absorbed routing and transformer pipeline.
- `src/prisma/schema.prisma` — Prisma schema and migrations.

### Monorepo packages

| Package | Name | Role |
|---------|------|------|
| `packages/cli` | `@ccr/cli` | Command-line tool providing the `ccr` command (published as `@musistudio/claude-code-router`) |
| `packages/shared` | `@ccr/shared` | Shared constants, utilities, and preset management |

### Routing

The router selects a model per request. Built-in scenarios are `default`,
`background`, `think` (Plan Mode), `longContext` (above a configurable token
threshold), `webSearch`, and `image`. Routing can also be driven by a custom
JavaScript router (`CUSTOM_ROUTER_PATH`) or project-level configuration.
Request size is estimated with `tiktoken` (`cl100k_base`).

### Transformers

Transformers adapt Anthropic-format requests to each provider's API. They can
be applied globally (provider level), per model, and configured with options.
Custom transformer plugins are loaded via the `transformers` array in the
disk envelope.

### Configuration store

Configuration is split across two stores:

- Disk envelope: `~/.claude-code-router/config.json` holds boot-time scalars
  (HOST, PORT, APIKEY, LOG, LOG_LEVEL, PROXY_URL, API_TIMEOUT_MS, CLAUDE_PATH,
  NON_INTERACTIVE_MODE) plus disk-resident objects (StatusLine, transformers,
  plugins). It uses JSON5, supports `$VAR` / `${VAR}` environment-variable
  interpolation, and keeps the last 3 automatic backups.
- PostgreSQL via Prisma: Providers, Models, and the RouterSlot rows.
  `DATABASE_URL` is read from `.env`.

On first boot, the server performs a one-shot, idempotent migration that lifts
any legacy Providers/Router found on disk into the database; it refuses to run
when both stores are already populated.

### HTTP surface and authentication

The `/api/*` and `/v1/*` routes are guarded by the envelope `APIKEY`. The key
is minted on first boot if unset, and clients must send it as the `x-api-key`
header or as `Authorization: Bearer <key>`. The web UI is served at `/`.

### Usage capture

A recurring usage-capture job runs via BullMQ on Redis and is started during
server bootstrap.

## Requirements

- Node.js >= 18 and Bun (the package manager and runtime; `engines.bun >= 1.1.0`).
- PostgreSQL and Redis.

For development, the devcontainer (`.devcontainer/compose.yaml`) provides the
`postgres` and `redis` services, so no manual database or cache setup is
required when developing inside it.

## Getting started

Install dependencies (this also runs `prisma generate` via `postinstall`):

```bash
bun install
```

Set `DATABASE_URL` in `.env` (the devcontainer's `postgres` service is the
default target in that environment):

```bash
DATABASE_URL=postgres://postgres:password@postgres:5432/ccr
```

Apply the database schema:

```bash
bun run db:migrate
```

Start the development server (Vite, host-exposed on port 16173):

```bash
bun run dev
```

The web UI is then available at http://localhost:16173.

Build for production:

```bash
bun run build
```

`build` runs `build:shared` followed by `build:ui`. The CLI is built
separately with `build:cli`.

Because `/api/*` and `/v1/*` are guarded by `APIKEY`, requests to those
routes must include the envelope key as `x-api-key` or
`Authorization: Bearer <key>`.

### Testing

Run the provider test suite:

```bash
bun run test:providers
```

Linting and formatting use Biome.

### Database tooling

| Script | Purpose |
|--------|---------|
| `bun run db:generate` | Regenerate the Prisma client |
| `bun run db:migrate` | Create and apply a new migration (development) |
| `bun run db:migrate:deploy` | Apply existing migrations (production / CI) |
| `bun run db:reset` | Drop and recreate the schema (destructive) |
| `bun run db:studio` | Open Prisma Studio |

Never edit DDL directly; always go through Prisma migrations.

### Price scraping

| Script | Purpose |
|--------|---------|
| `bun run scrape:openai-prices` | Scrape OpenAI prices |
| `bun run scrape:anthropic-prices` | Scrape Anthropic prices |
| `bun run scrape:google-prices` | Scrape Google/Gemini prices |
| `bun run scrape:prices` | Scrape all of the above |

### Release

| Script | Purpose |
|--------|---------|
| `bun run release` | Build, then release all targets |
| `bun run release:npm` | Release the npm package |
| `bun run release:docker` | Release the Docker image |

## CLI usage

The `ccr` command (from `@ccr/cli`) exposes the following subcommands:

```bash
ccr start       # Start the server
ccr stop        # Stop the server
ccr restart     # Restart the server
ccr status      # Show status
ccr code        # Run the claude command through the router
ccr model       # Interactive model selection and configuration
ccr preset      # Manage presets (export, install, list, info, delete)
ccr activate    # Output shell environment variables for integration
ccr ui          # Open the web UI
ccr statusline  # Integrated status line (reads JSON from stdin)
```

The configuration envelope is hot-reloaded only on restart (`ccr restart`).

## Configuration

### Envelope keys (disk)

These boot-time scalars live in `~/.claude-code-router/config.json`:

| Key | Description |
|-----|-------------|
| `HOST` | Listen address. Listens on `0.0.0.0` only when an `APIKEY` is set |
| `PORT` | Listen port |
| `APIKEY` | Secret key clients must send as `x-api-key` or `Authorization: Bearer` |
| `LOG` | Enable or disable log files |
| `LOG_LEVEL` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `PROXY_URL` | HTTP proxy for upstream API requests |
| `API_TIMEOUT_MS` | Timeout for upstream API calls (ms) |
| `CLAUDE_PATH` | Path to the `claude` executable |
| `NON_INTERACTIVE_MODE` | Set `true` for Docker / CI / GitHub Actions |

The envelope also stores disk-resident objects: `StatusLine`, `transformers`,
and `plugins`. Validation: when Providers are configured, both `HOST` and
`APIKEY` must be set; otherwise the server listens on `0.0.0.0` without
authentication.

### Providers, Models, and Router (database)

Providers, Models, and the per-scenario RouterSlot rows are stored in
PostgreSQL via Prisma, not in `config.json`. Manage them through the web UI or
the configuration API; change the schema only through Prisma migrations.

### Subagent routing

Pin a specific model for a subagent by prefixing its prompt with a tag:

```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
Please help me analyze this code...
```

### Presets

Presets let you save, share, and reuse configurations. They are stored in
`~/.claude-code-router/presets/<name>/manifest.json`. Sensitive fields
(api_key, password, secret) are automatically redacted to `{{field}}`
placeholders on export and prompted for on install.

```bash
ccr preset export <name>      # Export current configuration as a preset
ccr preset install <source>   # Install from a file, URL, or name
ccr preset list               # List installed presets
ccr preset info <name>        # Show preset information
ccr preset delete <name>      # Delete a preset
```

## Logging

- Server-level logs (pino): `~/.claude-code-router/logs/ccr-*.log` —
  HTTP requests, API calls, and server events. Controlled by `LOG_LEVEL`.
- Application-level logs: `~/.claude-code-router/claude-code-router.log` —
  routing decisions and business-logic events.

## License

MIT. See `LICENSE`.
