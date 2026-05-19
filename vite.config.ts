import { resolve } from 'node:path'
import devServer from '@hono/vite-dev-server'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Phase 1b of the Hono+Vite migration. The root combines:
//   - the React UI (was packages/ui/src — now lives under src/ and
//     src/app)
//   - the Hono server (src/index.ts)
// The legacy Fastify server still answers any /api or /v1 path that
// hasn't been ported yet; src/index.ts proxies those through.
export default defineConfig({
  base: './',
  server: {
    port: 3457,
    host: true,
    allowedHosts: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Pull workspace shared code from TS source so Vite's SSR module
      // runner doesn't try to evaluate the bun-target minified bundle
      // in packages/shared/dist.
      '@ccr/shared/data': resolve(__dirname, './packages/shared/src/data/index.ts'),
      '@ccr/shared/preset/types': resolve(__dirname, './packages/shared/src/preset/types.ts'),
      '@ccr/shared': resolve(__dirname, './packages/shared/src/index.ts')
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    devServer({
      entry: './src/index.ts',
      // Hono only owns /api/* and /v1/* — every other path (the SPA at
      // /, Vite's /@... module shims, /src/..., favicons, static
      // assets) goes through Vite. The negative lookahead is the
      // simplest way to express "exclude from Hono unless the path is
      // an API surface".
      exclude: [/^(?!\/api\/|\/v1\/).*$/]
    })
  ]
})
