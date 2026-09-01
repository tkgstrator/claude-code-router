/**
 * Project-specific router override.
 *
 * The session id is mapped to a project by finding the transcript
 * `<sessionId>.jsonl` under `~/.claude/projects/`; the override files
 * themselves live under the Rialto home, at `<HOME_DIR>/<project>/`.
 * Both are optional; a missing file / bad JSON / unknown shape silently
 * falls through to the next candidate (the global Router is the
 * always-available fallback).
 *
 * The filenames are unchanged by the rename — the directory moved with
 * the rest of the home (see services/config/migrate-home-dir), so an
 * operator's existing override files are carried over as they are.
 */

import { opendir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectRouterFileSchema } from '@/schemas/domain/scenario'
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from '@/shared/constants'
import type { RouterConfig, RouterRequest } from './types'

export async function getProjectRouter(req: RouterRequest): Promise<RouterConfig | undefined> {
  if (!req.sessionId) return undefined
  const project = await searchProjectBySession(req.sessionId)
  if (!project) return undefined

  // Per-session override wins over per-project override. Both files are
  // optional — missing files / bad JSON / unknown shape silently fall
  // through to the next candidate (no HTTPException here because the
  // global Router is the always-available fallback).
  const sessionPath = join(HOME_DIR, project, `${req.sessionId}.json`)
  const projectPath = join(HOME_DIR, project, 'config.json')
  for (const path of [sessionPath, projectPath]) {
    const parsed = await readProjectRouterFile(path, req)
    if (parsed?.Router) return parsed.Router
  }
  return undefined
}

async function readProjectRouterFile(path: string, req: RouterRequest): Promise<{ Router?: RouterConfig } | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined

  const raw = parseJsonSafely(text)
  if (raw === undefined) {
    req.log.warn({ path }, 'Project router file is not valid JSON; skipping')
    return undefined
  }

  const result = ProjectRouterFileSchema.safeParse(raw)
  if (!result.success) {
    req.log.warn(
      { path, err: JSON.stringify(result.error.issues) },
      'Project router file does not match schema; skipping'
    )
    return undefined
  }
  return result.data
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const sessionProjectCache = new Map<string, string | null>()

async function searchProjectBySession(sessionId: string): Promise<string | null> {
  const cached = sessionProjectCache.get(sessionId)
  if (cached !== undefined) return cached

  try {
    const dir = await opendir(CLAUDE_PROJECTS_DIR)
    const folderNames: string[] = []
    for await (const dirent of dir) {
      if (dirent.isDirectory()) folderNames.push(dirent.name)
    }

    const checks = await Promise.all(
      folderNames.map(async (folder) => {
        try {
          const filePath = join(CLAUDE_PROJECTS_DIR, folder, `${sessionId}.jsonl`)
          const s = await stat(filePath)
          return s.isFile() ? folder : null
        } catch {
          return null
        }
      })
    )

    for (const r of checks) {
      if (r) {
        sessionProjectCache.set(sessionId, r)
        return r
      }
    }
    sessionProjectCache.set(sessionId, null)
    return null
  } catch {
    sessionProjectCache.set(sessionId, null)
    return null
  }
}
