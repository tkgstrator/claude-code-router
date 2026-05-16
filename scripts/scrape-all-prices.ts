#!/usr/bin/env bun
/**
 * Run every per-vendor price scraper in sequence. Add new vendors to
 * SCRAPERS below.
 *
 *   bun run scripts/scrape-all-prices.ts          # write each JSON
 *   bun run scripts/scrape-all-prices.ts --dry    # forward --dry to each
 *
 * One failing vendor doesn't stop the rest — we collect non-zero
 * exits and report at the end.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

const SCRAPERS = [
  { name: 'openai', script: 'scripts/scrape-openai-prices.ts' },
  { name: 'anthropic', script: 'scripts/scrape-anthropic-prices.ts' },
  { name: 'google', script: 'scripts/scrape-gemini-pricing.ts' }
  // future: deepseek, xai, …
]

const dry = process.argv.includes('--dry')
const failures: string[] = []

for (const s of SCRAPERS) {
  console.error(`\n=== ${s.name} ===`)
  const args = [s.script]
  if (dry) args.push('--dry')
  const code = await new Promise<number>((resolve) => {
    const child = spawn('bun', ['run', ...args], { cwd: ROOT, stdio: 'inherit' })
    child.on('exit', (c) => resolve(c ?? 1))
  })
  if (code !== 0) failures.push(s.name)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} vendor(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.error('\nAll vendors scraped.')
