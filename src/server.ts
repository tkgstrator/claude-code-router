import { serveStatic } from 'hono/bun'
import app from './index'

// Thin production entry. `src/index.ts` is left untouched so the
// @hono/vite-dev-server path keeps working in `bun run dev`: in dev,
// Vite serves the SPA and only proxies /api/* + /v1/* into the Hono
// app. In production there is no Vite, so this module adds the missing
// piece — serving the built single-file SPA (dist/index.html) for any
// route the Hono app itself did not handle.
//
// Runtime module resolution: this file is launched with
// `bun --tsconfig-override tsconfig.runtime.json src/server.ts` (see
// Dockerfile CMD). The main tsconfig.json maps `@/llms/*` to a
// type-only stub for the strict `tsc` pass; Bun honours tsconfig
// paths at runtime and would otherwise try to execute that .d.ts and
// crash. The override drops that mapping so `@/llms/*` resolves to
// real source, exactly as Vite's alias does in dev. No code change is
// needed here for that — it is purely a launch flag.

// Ordering is load-bearing: `app` already registered the APIKEY guard
// (`/api/*`, `/v1/*`), every /api sub-app, the /v1 proxy and the
// /api/openapi.json doc route at import time. Hono dispatches in
// registration order, so attaching the static + SPA fallback AFTER the
// import makes it a strict last-resort catch-all. It can never shadow
// or strip the auth guard off an existing API route.

// Real asset files under dist/ (e.g. the extracted remixicon SVG that
// vite-plugin-singlefile cannot inline). Serves the file when it
// exists, otherwise falls through via next() to the SPA fallback.
app.use('/*', serveStatic({ root: './dist' }))

// SPA fallback: anything still unmatched is a client-side route, so
// hand back the fully-inlined index.html. Scoped to GET to avoid
// swallowing stray non-API writes with a 200 HTML body.
const indexHtml = await Bun.file('./dist/index.html').text()
app.get('/*', (c) => c.html(indexHtml))

// Bun auto-serves a default export of `{ port, fetch }`, binding
// 0.0.0.0.
//
// Port: importing ./index above ran bootstrapServer() ->
// initConfig() -> applyEnvelopeToEnv(), which mirrors the config
// envelope's PORT onto process.env.PORT (the app's own canonical
// listen port — 3456 by default in a fresh envelope, configurable via
// the UI / config.json). We MUST bind exactly that port: any in-app
// feature that builds a self URL from process.env.PORT would
// otherwise point at the wrong port. So the envelope-resolved PORT
// wins; only if it is unset/invalid do we fall back to 16173 (the
// historical dev-server port). Resolved without `||`/`??`.
const parsedPort = Number(process.env.PORT)
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 16173

// Bun's per-request idle timeout defaults to 10s and kills any socket
// that goes quiet for that long. LLM calls routinely think for far
// longer than 10s before the first token (and a streamed answer can
// pause mid-flight), so the default makes Bun abort live requests with
// "request timed out after 10 seconds". 255 is Bun's maximum and the
// only value high enough to cover slow upstream models / long agent
// turns; lower values just reintroduce the cutoff. Override via
// API_TIMEOUT_MS (seconds, clamped to Bun's 1..255 range) if needed.
const parsedIdle = Math.round(Number(process.env.API_TIMEOUT_MS) / 1000)
const idleTimeout = Number.isFinite(parsedIdle) && parsedIdle > 0 ? Math.min(parsedIdle, 255) : 255

export default {
  port,
  idleTimeout,
  fetch: app.fetch
}
