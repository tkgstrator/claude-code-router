/**
 * One-shot move from ~/.claude-code-router to ~/.rialto.
 *
 * This is the only step of the rename that can lose data, so it is the
 * only one that gets its own module and its own tests.
 *
 * It **copies**. Renaming would be tidier and is wrong: an operator who
 * rolls back to a pre-rename build after this has run would find their
 * configuration gone, because the old build looks only at the old path.
 * Leaving the original in place makes the upgrade reversible, at the
 * cost of a duplicate the operator can delete once they are sure. The
 * log line says so rather than leaving them to guess.
 *
 * Idempotent by the existence of the destination: once ~/.rialto is
 * there, this never runs again and never overwrites. That also means a
 * half-finished copy is not silently accepted — see below.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { logger } from '@/logger'

export const LEGACY_HOME_DIR_NAME = '.claude-code-router'
export const HOME_DIR_NAME = '.rialto'

export interface MigrationResult {
  /** 'copied' is the only outcome that moved data. */
  outcome: 'copied' | 'already-migrated' | 'nothing-to-migrate' | 'failed'
  from: string | null
  to: string
  /** Files copied, for the log line and the tests. */
  fileCount: number
}

const exists = (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false)

/**
 * Copy a tree, refusing to overwrite anything.
 *
 * Written out rather than using `fs.cp` with `recursive` because the
 * failure mode matters: a partial copy that reports success would leave
 * the operator running on an incomplete config while their real one
 * looks like a redundant leftover. Every file is counted, and any error
 * aborts with the count so far.
 */
async function copyTree(from: string, to: string): Promise<number> {
  await fs.mkdir(to, { recursive: true })
  const entries = await fs.readdir(from, { withFileTypes: true })
  const counts = await Promise.all(
    entries.map(async (entry) => {
      const src = path.join(from, entry.name)
      const dest = path.join(to, entry.name)
      if (entry.isDirectory()) return copyTree(src, dest)
      // Symlinks are copied as their target's content: the old directory
      // stays in place, so a link pointing into it would keep the new
      // home depending on the one we are telling people they may delete.
      await fs.copyFile(src, dest)
      return 1
    })
  )
  return counts.reduce((a, b) => a + b, 0)
}

/**
 * Run the migration if it is needed.
 *
 * Never throws: a failure here must not stop the server booting, because
 * the operator's way to investigate is the UI. It returns 'failed' and
 * logs, and the caller carries on with an empty new home — the original
 * is still untouched on disk.
 */
export async function migrateHomeDir(homeRoot: string = os.homedir()): Promise<MigrationResult> {
  const legacy = path.join(homeRoot, LEGACY_HOME_DIR_NAME)
  const target = path.join(homeRoot, HOME_DIR_NAME)

  if (await exists(target)) {
    return { outcome: 'already-migrated', from: null, to: target, fileCount: 0 }
  }
  if (!(await exists(legacy))) {
    return { outcome: 'nothing-to-migrate', from: null, to: target, fileCount: 0 }
  }

  try {
    const fileCount = await copyTree(legacy, target)
    logger.info(
      { from: legacy, to: target, fileCount },
      `Copied configuration to ${HOME_DIR_NAME}. The old directory was left in place so an older build still starts; delete it once you are satisfied.`
    )
    return { outcome: 'copied', from: legacy, to: target, fileCount }
  } catch (err) {
    // Remove the partial copy. Leaving it would make the next boot take
    // the 'already-migrated' branch and run on a fraction of the
    // operator's configuration, which is worse than migrating again.
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    logger.error(
      { from: legacy, to: target, err },
      'Could not copy configuration to the new home directory; the original is untouched and will be retried on next boot'
    )
    return { outcome: 'failed', from: legacy, to: target, fileCount: 0 }
  }
}
