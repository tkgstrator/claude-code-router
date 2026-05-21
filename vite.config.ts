import { resolve } from 'node:path'
import devServer from '@hono/vite-dev-server'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  server: {
    port: 3457,
    host: true,
    allowedHosts: true
  },
  resolve: {
    alias: [{ find: '@', replacement: resolve(__dirname, './src') }]
  },
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    devServer({
      entry: './src/index.ts',
      // Hono owns /api/*, /v1/*, and the claude OAuth loopback callback
      // /callback. Every other path (the SPA at /, Vite's /@... module
      // shims, /src/..., favicons, static assets) goes through Vite. The
      // callback must be served by the backend so the auto-exchange +
      // sync runs server-side instead of bouncing through the SPA.
      // Codex's callback hits a separate standalone listener on
      // localhost:1455 (see services/codex-callback-listener.ts), so it
      // doesn't go through Vite at all.
      exclude: [/^(?!\/api\/|\/v1\/|\/callback(?:\?|$)).*$/]
    })
  ]
})
