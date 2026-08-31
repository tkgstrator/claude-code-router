/**
 * Compile mocks/_shared/mock.css with the project's own Tailwind build.
 *
 * The mocks are plain static HTML opened over file:// (no dev server, no
 * CDN) — but they must resolve the SAME utilities and the SAME design
 * tokens as the React app, otherwise the ui-mock-diff screenshot
 * comparison measures Tailwind-version drift instead of design drift.
 * Running the repo's installed @tailwindcss/postcss over the mock entry
 * gives that guarantee for free.
 *
 * Usage:
 *   bun run mocks:css            # one-shot build
 *   bun run mocks:css --watch    # rebuild on mock/css changes
 */

import { watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'

const ROOT = join(import.meta.dir, '..')
const ENTRY = join(ROOT, 'mocks/_shared/mock.css')
const OUT = join(ROOT, 'mocks/_shared/mock.build.css')
const APP_CSS = join(ROOT, 'src/index.css')

// Token blocks the mock entry copies from src/index.css. Drift here is the
// one failure mode that silently poisons every screenshot diff, so the
// build refuses to emit a stale bundle rather than warning into a log
// nobody reads.
const TOKEN_BLOCKS = [':root {', '.dark {'] as const

const extractBlock = (css: string, opener: string): string | null => {
  const start = css.indexOf(`\n${opener}`)
  if (start === -1) return null
  const end = css.indexOf('\n}', start)
  if (end === -1) return null
  return css
    .slice(start, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--'))
    .sort()
    .join('\n')
}

const assertTokensInSync = async (): Promise<void> => {
  const [app, mock] = await Promise.all([readFile(APP_CSS, 'utf8'), readFile(ENTRY, 'utf8')])
  const drifted = TOKEN_BLOCKS.filter((opener) => extractBlock(app, opener) !== extractBlock(mock, opener))
  if (drifted.length > 0) {
    throw new Error(
      `mock.css token drift in ${drifted.join(', ')} — src/index.css and mocks/_shared/mock.css disagree.\n` +
        'Copy the block across before rebuilding, or every screenshot diff will be measuring the wrong thing.'
    )
  }
}

// Compiled through @tailwindcss/node rather than the postcss plugin: the
// repo resolves two copies of postcss (one nested under
// @tailwindcss/postcss), and the duplicated declarations make
// `postcss([tailwind()])` fail `tsc` with an excessive-stack-depth
// comparison. The node API is the same compiler with one set of types.
export const buildMockCss = async (): Promise<void> => {
  await assertTokensInSync()
  const css = await readFile(ENTRY, 'utf8')
  const compiler = await compile(css, { base: dirname(ENTRY), from: ENTRY, onDependency: () => {} })

  // `sources` comes from the entry's @source directives; `root` is
  // Tailwind's own auto-detection base. Feed both to the scanner so a
  // class only present in shell.js is still emitted.
  const sources = [...compiler.sources]
  if (compiler.root !== null && compiler.root !== 'none') {
    sources.push({ ...compiler.root, negated: false })
  }
  const candidates = new Scanner({ sources }).scan()
  const output = compiler.build(candidates)

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, output, 'utf8')
  const kb = (Buffer.byteLength(output) / 1024).toFixed(1)
  console.log(`[mocks:css] ${OUT.replace(`${ROOT}/`, '')} — ${kb} kB · ${candidates.length} candidates`)
}

/**
 * Rebuild whenever mock markup changes. Exported so `mocks:serve` can
 * arm the same watcher instead of asking the reviewer to run two
 * processes.
 */
export const watchMockCss = (): void => {
  console.log('[mocks:css] watching mocks/ …')
  let queued = false
  watch(join(ROOT, 'mocks'), { recursive: true }, (_event, filename) => {
    if (typeof filename === 'string' && filename.endsWith('.build.css')) return
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      buildMockCss().catch((err: unknown) => console.error('[mocks:css]', err))
    }, 120)
  })
}

// Only self-run when invoked directly (`bun run mocks:css`); importing
// this module from serve-mocks.ts must not trigger a build.
if (import.meta.main) {
  await buildMockCss()
  if (process.argv.includes('--watch')) watchMockCss()
}
