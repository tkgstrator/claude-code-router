/**
 * Static server for the UI mocks — the human review path.
 *
 * The mocks also open straight over file://, which is what the
 * screenshot capture uses (no server, deterministic, works in CI). This
 * server exists so a reviewer can look at them from another device, over
 * a forwarded port, or through a tunnel.
 *
 *   bun run mocks:serve              # port 16176
 *   bun run mocks:serve -- --port 8080
 *   bun run mocks:serve -- --no-watch
 *
 * Rendering is identical to file://: the same files, the same relative
 * asset paths. The server only has to resolve `/mocks/**` and the two
 * font/icon packages the mocks link out of node_modules.
 *
 * Deliberately NOT the Vite dev server on :16175 — that one belongs to
 * the app, is already running, and routing the mocks through its
 * transform pipeline would undermine the whole point of compiling them
 * with the project's Tailwind ahead of time.
 */

import { existsSync, statSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { buildMockCss, watchMockCss } from './build-mock-css.ts'

const ROOT = resolve(import.meta.dir, '..')

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

const PORT = Number(arg('--port') ?? process.env.MOCKS_PORT ?? 16176)

// Strict allowlist. The server is rooted at the repo so the mocks' own
// `../node_modules/...` links resolve, which without a gate would also
// expose .env, .dev.vars and the whole source tree on a listening port.
// Anything not matching one of these prefixes is a 404.
const ALLOWED_PREFIXES = [
  'mocks/',
  'node_modules/@fontsource-variable/',
  'node_modules/remixicon/'
] as const

const isAllowed = (relative: string): boolean => ALLOWED_PREFIXES.some((p) => relative.startsWith(p))

const notFound = (message: string): Response =>
  new Response(`404 — ${message}\n`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })

await buildMockCss()
if (!process.argv.includes('--no-watch')) watchMockCss()

const server = Bun.serve({
  port: PORT,
  // 0.0.0.0 so a forwarded devcontainer port and other devices on the
  // LAN can reach it. These are static design mocks with fixture data —
  // there is nothing here to authenticate.
  hostname: '0.0.0.0',
  fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/' || url.pathname === '/mocks' || url.pathname === '/mocks/') {
      return Response.redirect('/mocks/index.html', 302)
    }

    // normalize() collapses any ../ before the allowlist check, so a
    // traversal attempt fails the prefix test rather than escaping ROOT.
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
    if (!isAllowed(relative)) return notFound(`${url.pathname} is not served`)

    const path = join(ROOT, relative)
    if (!existsSync(path) || statSync(path).isDirectory()) return notFound(`${url.pathname} not found`)

    return new Response(Bun.file(path), {
      // Mocks change while a reviewer is looking at them; a cached
      // stylesheet after a rebuild is the classic "why is nothing
      // updating" trap.
      headers: { 'cache-control': 'no-store' }
    })
  }
})

console.log(`[mocks:serve] http://localhost:${server.port}/mocks/index.html`)
console.log('[mocks:serve] ctrl-c to stop')
