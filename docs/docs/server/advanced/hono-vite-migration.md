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

We follow the layout from
[qtmleap/Hono-Vite-Workers](https://github.com/qtmleap/Hono-Vite-Workers)
(minus the Cloudflare Workers piece). Vite is the single dev / build tool;
Hono runs inside the same Vite process via `@hono/vite-dev-server` in dev and
as the production handler in prod.

```
ccr/
  src/
    index.ts          # Hono entry — registers /api/*, /v1/*, falls through
                      # to the SPA. Becomes the prod handler.
    app/              # React entry + routes — replaces packages/ui/src.
      main.tsx
      routes/
    server/           # API + provider services — replaces packages/server/src.
    shared.ts         # cross-cutting glue (env loading, prisma client, etc.)
  packages/
    cli/              # unchanged
    core/             # @musistudio/llms — POJO-friendly exports
                      # (Phase 0)
    shared/           # unchanged
  vite.config.ts      # @hono/vite-dev-server + @vitejs/plugin-react.
  package.json        # "dev": "vite", "build": "vite build",
                      # "start": "bun src/index.ts"
```

Dev / build / start become single commands:

| Command | Effect |
|---|---|
| `bun run dev` | one Vite dev server. UI HMR + Hono API on the same port. No `wait-on`, no concurrent process orchestration. |
| `bun run build` | `vite build` emits both the SPA bundle and the Hono worker bundle. |
| `bun run start` | `bun src/index.ts` runs the built Hono entry against the static dist. |

The current monorepo split between `packages/server` and `packages/ui` goes
away — both fold into the root `src/`. `packages/cli`, `packages/core`, and
`packages/shared` stay as workspace libraries; the CLI keeps shelling out to
the Bun runtime to spawn the server.

## Phased rollout

Each phase is one PR. CI must stay green at every step.

### Phase 0 — Library export hardening (in progress)

- Audit `@musistudio/llms`'s public exports (done; see
  [Library exports](#library-exports-from-musistudiollms)).
- Refactor Fastify-typed entry points to receive POJO request shapes so the
  same services can be called from Hono handlers. Candidates: `router(req)`,
  agent `shouldHandle` / `reqHandler`, plugin manager hook surface.
- Leave the existing Fastify wrapper in place; adapter functions translate
  Fastify Request → POJO at the call site so the current server keeps
  working.

### Phase 1 — Stand up the new root with `@hono/vite-dev-server`

- Add `vite.config.ts` at the repo root with `@hono/vite-dev-server` and
  `@vitejs/plugin-react`. Hono entry at `src/index.ts`, React entry at
  `src/app/main.tsx` (mirror the [qtmleap reference](https://github.com/qtmleap/Hono-Vite-Workers)).
- Move the simplest API routes (`GET /api/config`, `GET /api/subscriptions`,
  `GET /api/transformers`, `GET /api/update/check`) into `src/index.ts`.
  These already work as POJO-friendly handlers (the PoC in
  `packages/server-hono-poc` proved `composeUiConfig` is framework-clean).
- Old Fastify server in `packages/server` keeps running on 3456 for routes
  not yet ported. The new root server proxies them through during the
  transition.
- `bun run dev` now points at `vite` only. The two-process orchestration
  (`bun run --filter @ccr/server dev & wait-on tcp:3456 && ...`) disappears
  for the routes already ported.

### Phase 2 — Migrate /api/* and UI source

- Move the rest of `/api/*` into `src/index.ts` (config save, refresh-models,
  providers/test, update/perform, restart). Replace `@fastify/multipart`
  with `c.req.parseBody()` for preset zip uploads.
- Move `packages/ui/src/*` into `src/app/*`. The Vite root is now the repo
  root, so the UI imports go through `@/...` aliases pointing at `src/`.
- Delete `packages/server` and `packages/ui` workspace entries once all
  routes / files have moved. `vite.config.ts` now sees one source tree.
- Static asset serving in prod: `vite build` emits `dist/`; the Hono
  production handler in `src/index.ts` uses `serveStatic({ root: './dist' })`.

### Phase 3 — Move /v1/messages off Fastify

- Build a Hono handler that:
  1. Reads the request, picks scenario via `router(req)` (POJO from Phase 0).
  2. Applies request transformers via `TransformerService`.
  3. `fetch()` upstream.
  4. Streams the response back through `SSEParserTransform` /
     `SSESerializerTransform`, with `rewriteStream` wrapped around agent
     tool calls.
- Re-implement the `preHandler` / `onSend` hook semantics using Hono
  middleware. Agent tool detection runs as a `before` middleware on the
  handler.
- Tokenizer endpoint (`POST /v1/messages/count_tokens`) gets the same
  treatment — `calculateTokenCount` is already a pure function.

### Phase 4 — Decommission Fastify

- Remove the Fastify wrapper from `@musistudio/llms`. Either delete the
  default `Server` export or move it behind a `@musistudio/llms/fastify`
  subpath so consumers who still rely on it can opt-in.
- Drop Fastify-related dependencies (`fastify`, `@fastify/multipart`,
  `@fastify/static`, `@fastify/cors`).
- The dev command is just `bun run dev` (= `vite`); the prod command is
  `bun src/index.ts`; nothing routes through Fastify any more.

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
- **`@hono/vite-dev-server` adapter**: the PoC in `packages/vite-hono-poc`
  bridged Vite middlewares to Hono by hand-rolling a Node IncomingMessage
  shim. `@hono/vite-dev-server` removes that — it ships a Vite plugin that
  hands Hono the request before falling through to the SPA. Verify the
  plugin's `injectClientScript` / `adapter` options match what we need.
- **Workspace dependency wiring**: once `src/` is the Vite root, the imports
  that currently reach into `@ccr/server` or `@ccr/ui` need to resolve to
  the local source. `packages/server-hono-poc`'s `./config` subpath export
  on `@ccr/server` is the right precedent — narrow exports per consumer.
- **Logging**: pino is currently the source of structured logs. Hono ships
  with a much thinner logger. Decide whether to keep pino (just instantiate
  it manually) or move to console-style structured logs.

## Open question for kickoff

Once Phase 0 lands and the library exports are confirmed Hono-friendly, do we
ship Phase 1 as a mixed-source PR (root `src/` + `packages/server` Fastify
still running for un-ported routes) or jump straight to a "delete
`packages/server` and `packages/ui`" PR? The former is safer but ships glue
code; the latter is cleaner but a much larger diff to review.
