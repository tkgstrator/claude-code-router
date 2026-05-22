#!/usr/bin/env bun
/**
 * Analyzes the git diff between the current branch and the base branch,
 * asks Claude to determine the appropriate semver bump (major/minor/patch),
 * updates package.json, and commits the change.
 *
 * Usage: bun run scripts/auto-bump-version.ts [base-branch]
 * Default base branch: develop
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

const ROOT = resolve(import.meta.dirname, '..')
const PKG_PATH = resolve(ROOT, 'package.json')

function run(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim()
}

function bumpVersion(current: string, bump: 'major' | 'minor' | 'patch'): string {
  const [major, minor, patch] = current.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

async function determineBump(diff: string, log: string): Promise<'major' | 'minor' | 'patch'> {
  const client = new Anthropic()
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    system:
      'You are a semantic versioning expert. Analyze the provided git diff and commit log, then respond with exactly one word: major, minor, or patch.\n\n' +
      'Rules:\n' +
      '- major: breaking API changes, incompatible changes to existing interfaces\n' +
      '- minor: new features, new endpoints, new options that are backwards-compatible\n' +
      '- patch: bug fixes, performance improvements, documentation, refactors with no behavior change\n\n' +
      'Respond with only the word: major, minor, or patch',
    messages: [
      {
        role: 'user',
        content: `Commit log:\n${log}\n\nDiff summary:\n${diff.slice(0, 8000)}`
      }
    ]
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim().toLowerCase() : ''
  if (text === 'major' || text === 'minor' || text === 'patch') return text
  return 'patch'
}

async function main() {
  const baseBranch = process.argv[2] ?? 'develop'

  // Check if there are actual code changes (not just the version commit itself)
  let diff: string
  let log: string
  try {
    diff = run(`git diff ${baseBranch}...HEAD -- . ':(exclude)package.json'`)
    log = run(`git log ${baseBranch}...HEAD --oneline`)
  } catch {
    console.log('Could not compute diff — skipping version bump')
    process.exit(0)
  }

  if (!diff && !log) {
    console.log('No changes detected — skipping version bump')
    process.exit(0)
  }

  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as { version: string }
  const currentVersion = pkg.version

  console.log(`Analyzing diff to determine semver bump (current: ${currentVersion})…`)
  const bump = await determineBump(diff, log)
  const nextVersion = bumpVersion(currentVersion, bump)

  if (nextVersion === currentVersion) {
    console.log('Version unchanged — nothing to do')
    process.exit(0)
  }

  pkg.version = nextVersion
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')

  run(`git add ${PKG_PATH}`)
  run(`git commit -m "chore: bump version to ${nextVersion} (${bump})"`)

  console.log(`Bumped ${currentVersion} → ${nextVersion} (${bump})`)
}

main().catch((err) => {
  console.error('auto-bump-version failed:', err)
  process.exit(1)
})
