---
sidebar_position: 99
---

# Hono + Vite Migration Plan

Plan for moving the CCR server off Fastify (via `@musistudio/llms`'s default
`Server` class) onto Hono running on Bun, while keeping Vite as the UI bundler.
Tracks the rationale, the staged rollout, and the open questions.

## Goals

- Replace the Fastify-based HTTP layer with Hono so the request pipeline lives
  on a single Bun-native framework.
- Keep `@musistudio/llms` as a library — reuse its `TransformerService`,
  `TokenizerService`, `router`, SSE utilities, and tokenizer cache. Drop only
  the `Server` default export.
- Co-locate the UI assets under the same Bun process. The Vite build keeps
  emitting the SPA; Hono serves the bundle and proxies API calls in dev.
- Land the move in incremental PRs that each leave `develop` runnable.

## Non-goals

- Re-implementing the transformer system. Anything in `@musistudio/llms`
  except the Fastify wrapper is treated as a black box.
- Switching frontend frameworks. The React + Vite app stays as-is.
- Migrating the CLI. `packages/cli` keeps shelling out to the server with the
  same on-disk envelope + Postgres contract.

## Current architecture

```
packages/
  core/        @musistudio/llms (Fastify Server + transformer/tokenizer/router)
  server/      thin wrapper around core's Server, adds CCR-specific routes
  cli/         spawns `bun src/index.ts`, owns /api/restart and /api/update/*
  ui/          React + Vite, served from packages/server/dist via /ui/
  shared/      seed data, presets, ScenarioKey enum, config envelope schema
```

Key Fastify points of contact (everything that has to be ported):

| Touchpoint | Source | Notes |
|---|---|---|
| `app.register(fastifyMultipart)` | `packages/server/src/server.ts` | preset zip uploads |
| `app.register(fastifyStatic)` | same | serves the built UI under `/ui/` |
| `app.get/post('/api/...')` | same + `packages/cli/src/utils/index.ts` | management surface |
| `app.post('/v1/messages/count_tokens')` | `packages/server/src/server.ts` | tokenizer hand-off |
| `app.post('/v1/messages')` | `@musistudio/llms` internals | the transformer pipeline, owned by core |
| `preHandler` / `onSend` hooks | core + agents | agent tool detection and SSE rewrite |
| `app.log` | Fastify pino | swap for Bun-friendly logger |

## Target architecture

```
packages/
  core/        @musistudio/llms — keep transformer/tokenizer/router exports,
               deprecate the default Server class (or split into
               core-library + core-fastify subpath exports).
  server/      Hono app on Bun, owns ALL routes — /api/*, /v1/*, /ui/*.
               Calls into core's services directly inside its handlers.
  ui/          unchanged source; the build artifact is served by the Hono
               static handler.
  cli/         unchanged; the CLI spawns the same server entrypoint and
               registers /api/restart, /api/update/* as Hono routes.
  shared/      unchanged.
```

## Phased rollout

Each phase is one PR. CI must stay green at every step.

### Phase 0 — Inventory and library export hardening

- Audit `@musistudio/llms`'s public exports (already done; results captured in
  the [Library exports](#library-exports-from-musistudiollms) section below).
- Where the existing exports lean on Fastify request/reply types, add narrow
  POJO adapters so the same services can be called from Hono context. Most
  likely candidates: `router(req)`, `agent.shouldHandle(req)`.
- Document the shape each service expects so the Hono handlers can build it.

### Phase 1 — Hono mounts alongside Fastify

- Spin up Hono in the same process but on a separate internal port.
- Move the lowest-risk management routes (`GET /api/config`, `GET /api/transformers`,
  `GET /api/subscriptions`, `GET /api/update/check`) to Hono first.
- Fastify keeps everything else. A thin reverse-proxy in Hono forwards
  unmatched paths to Fastify; alternatively, Fastify forwards `/api/*` it
  doesn't recognise to Hono. Either direction works; pick the one with fewer
  hook-order surprises.
- Vite dev proxy in `packages/ui/vite.config.ts` keeps pointing at the same
  external port; the in-process router decides who answers.

### Phase 2 — Move the rest of /api to Hono

- `POST /api/config` (calls `applyUiConfig`), `POST /api/refresh-models`,
  `POST /api/providers/test`, `POST /api/update/perform`, `POST /api/restart`.
- Multipart uploads: switch `fastifyMultipart` for Hono's built-in
  `c.req.parseBody()` / `c.req.formData()`.
- Static UI: switch `fastifyStatic` for `serveStatic` from `hono/bun`. Inline
  the SPA fallback (`/ui` → `/ui/index.html`).
- Log line shape: swap pino for the Bun logger or keep pino directly through
  a small wrapper.

### Phase 3 — Move /v1/messages off Fastify

- The hot path. Build a Hono handler that:
  1. Reads the request, picks scenario via `router`.
  2. Applies request transformers via `TransformerService`.
  3. `fetch()` upstream (or hands off to the existing provider service).
  4. Streams the response back through `SSEParserTransform` /
     `SSESerializerTransform`, with `rewriteStream` wrapped around agent tool
     calls.
- Re-implement the `preHandler` / `onSend` hook semantics using Hono
  middleware. Agent tool detection runs as a `before` middleware on the
  handler.
- Tokenizer endpoint (`POST /v1/messages/count_tokens`) gets the same
  treatment — `calculateTokenCount` is already a pure function.

### Phase 4 — Decommission Fastify

- Remove the Fastify wrapper from `@musistudio/llms`. Either delete the default
  `Server` export or move it behind a `@musistudio/llms/fastify` subpath so
  consumers who still rely on it can opt-in.
- Drop Fastify-related dependencies from `packages/server/package.json`
  (`fastify`, `@fastify/multipart`, `@fastify/static`, `@fastify/cors`).
- Final dev-server simplification: a single `bun --watch src/index.ts` that
  serves both API and UI, Vite middleware-mode imported into Hono for HMR.

## Library exports from @musistudio/llms

Already public (`packages/core/src/server.ts`):

- default `Server` — to be removed or relocated.
- `router` — scenario → provider,model resolver.
- `TransformerService`, `TokenizerService`, `ProviderService`, `ConfigService`.
- `SSEParserTransform`, `SSESerializerTransform`, `rewriteStream`.
- `pluginManager`, `tokenSpeedPlugin`, type `CCRPlugin`.
- `calculateTokenCount`.
- `sessionUsageCache`.

Watchlist — these may need POJO adapters before Hono can call them:

- `pluginManager` hooks expect a Fastify-shaped `app`; will need a small
  shim that exposes `addHook`-style register hooks the manager can call.
- `router(req)` takes Fastify `Request`; refactor to accept a plain object
  with `headers`, `body`, `query` so both frameworks can call it.
- Agent system's `preHandler`/`onSend` hook contracts are Fastify-flavoured.

## Risks and open questions

- **Plugin system parity**: `@musistudio/llms`'s `pluginManager` exposes
  Fastify hook semantics to third-party plugins. Moving to Hono either breaks
  those plugins or requires a compatibility layer.
- **SSE backpressure**: Fastify's response stream handling is battle-tested
  for SSE; Hono on Bun's `Response` with a `ReadableStream` should be
  equivalent, but worth load-testing.
- **CLI restart contract**: `/api/restart` currently triggers `process.exit(0)`
  and relies on the bun `while` loop to respawn. The handler ports cleanly,
  but the dev script may need adjusting if Hono's request lifecycle is
  different.
- **Vite middleware-mode integration**: Bun is faster at module resolution
  than Node, and Vite's middleware mode is built around Connect. We may need
  to keep Vite as a separate dev process and proxy from Hono.
- **Logging**: pino is currently the source of structured logs. Hono ships
  with a much thinner logger. Decide whether to keep pino (just instantiate
  it manually) or move to console-style structured logs.

## Open question for kickoff

Once Phase 0 lands and the library exports are confirmed Hono-friendly, do we
land Phase 1's mixed-framework PR (Hono + Fastify side by side) or jump
straight to a "Hono-only" PR that ports every route at once? The former is
safer but ships a longer tail of glue code; the latter is cleaner but a much
larger diff to review.
