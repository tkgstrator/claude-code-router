import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"
import tailwindcss from "@tailwindcss/vite"

 
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3456',
      '/v1': 'http://localhost:3456',
      '/ui': 'http://localhost:3456',
    },
  },
})
