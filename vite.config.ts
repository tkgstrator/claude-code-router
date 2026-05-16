import { resolve } from 'node:path'
import devServer from '@hono/vite-dev-server'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Phase 1a of the Hono+Vite migration. The new root combines a Hono
// server (src/index.ts) with the existing React/Vite UI. During the
// transition the old Fastify server at packages/server still owns
// every route that hasn't been ported yet — src/index.ts proxies any
// /api/* or /v1/* request it doesn't handle to localhost:3456 so the
// app stays usable from this dev server alone.
export default defineConfig({
  server: {
    port: 3457,
    host: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  plugins: [
    react(),
    devServer({
      entry: './src/index.ts',
      // Default exclude misses things like /api/config, so widen it to
      // skip dev-server interception for Vite client + module assets
      // only. Everything else flows through Hono.
      exclude: [
        /^\/@.+$/,
        /\/favicon\.ico$/,
        /^\/(?:src|node_modules)\/.+/,
        /\?import$/,
        /\.(?:css|less|sass|scss|stylus|wasm|html|svg|png|jpg|jpeg|gif|webp|ico)$/
      ]
    })
  ]
})
