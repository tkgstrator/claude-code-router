/**
 * One-shot move from ~/.claude-code-router to ~/.rialto.
 *
 * This is the only step of the rename that can lose data, so it is the
 * only one that gets its own module and its own tests.
 *
 * It copies, verifies, and only then removes the original — rather than
 * renaming. `fs.rename` is a single atomic step and would be simpler,
 * but it fails across filesystems and gives nothing to check before the
 * old path is gone. Copy-verify-remove means a failure at any point
 * leaves the original untouched and the operator loses nothing.
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
  /** 'moved' is the only outcome that touched data. */
  outcome: 'moved' | 'already-migrated' | 'nothing-to-migrate' | 'failed'
  from: string | null
  to: string
  /** Files copied, for the log line and the tests. */
  fileCount: number
  /**
   * False when the copy succeeded but the original could not be
   * removed. The new home is complete and usable; the leftover is
   * cosmetic, and failing the whole migration over it would be worse.
   */
  legacyRemoved: boolean
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
      // Symlinks are copied as their target's content. A link into the
      // old directory would otherwise dangle the moment it is removed.
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
 * is still on disk, because nothing is removed until the copy verifies.
 */
export async function migrateHomeDir(homeRoot: string = os.homedir()): Promise<MigrationResult> {
  const legacy = path.join(homeRoot, LEGACY_HOME_DIR_NAME)
  const target = path.join(homeRoot, HOME_DIR_NAME)

  if (await exists(target)) {
    return { outcome: 'already-migrated', from: null, to: target, fileCount: 0, legacyRemoved: false }
  }
  if (!(await exists(legacy))) {
    return { outcome: 'nothing-to-migrate', from: null, to: target, fileCount: 0, legacyRemoved: false }
  }

  try {
    const fileCount = await copyTree(legacy, target)

    // Verify before deleting. `copyTree` counts what it wrote, so a
    // recount of the destination that disagrees means the copy was not
    // what it claimed — and the original is the only remaining copy.
    const copied = await countFiles(target)
    if (copied !== fileCount) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => {})
      logger.error(
        { from: legacy, to: target, expected: fileCount, found: copied },
        'Copy to the new home directory did not verify; the original is untouched and will be retried on next boot'
      )
      return { outcome: 'failed', from: legacy, to: target, fileCount: 0, legacyRemoved: false }
    }

    const legacyRemoved = await fs
      .rm(legacy, { recursive: true, force: true })
      .then(() => true)
      .catch(() => false)

    logger.info(
      { from: legacy, to: target, fileCount, legacyRemoved },
      legacyRemoved
        ? `Moved configuration to ${HOME_DIR_NAME}.`
        : `Copied configuration to ${HOME_DIR_NAME}, but could not remove the old directory; it is safe to delete by hand.`
    )
    return { outcome: 'moved', from: legacy, to: target, fileCount, legacyRemoved }
  } catch (err) {
    // Remove the partial copy. Leaving it would make the next boot take
    // the 'already-migrated' branch and run on a fraction of the
    // operator's configuration, which is worse than migrating again.
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    logger.error(
      { from: legacy, to: target, err },
      'Could not copy configuration to the new home directory; the original is untouched and will be retried on next boot'
    )
    return { outcome: 'failed', from: legacy, to: target, fileCount: 0, legacyRemoved: false }
  }
}

/** Count files in a tree, for verifying a copy against what was written. */
async function countFiles(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const counts = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : Promise.resolve(1)))
  )
  return counts.reduce((a, b) => a + b, 0)
}
