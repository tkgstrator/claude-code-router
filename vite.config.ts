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
    alias: [
      // Order matters: longer prefix first so '@/llms/*' wins over '@/*'.
      // Keeps the logical alias `@/llms` stable while the physical
      // directory moved under src/vendor/ to signal it's third-party.
      { find: /^@\/llms\//, replacement: `${resolve(__dirname, './src/vendor/llms')}/` },
      { find: '@', replacement: resolve(__dirname, './src') }
    ]
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
