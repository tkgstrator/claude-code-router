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
      '@': resolve(__dirname, './src')
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    devServer({
      entry: './src/index.ts',
      // Default exclude misses /api/* — widen it so the Vite client +
      // module asset paths bypass Hono, everything else flows through.
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
