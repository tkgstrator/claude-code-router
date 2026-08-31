#!/usr/bin/env bun
/**
 * Exercise the Codex OAuth refresh flow against every registered Codex
 * SubAccount and report what happens end-to-end. Used to diagnose the
 * "period expires and I have to re-import auth.json every time" bug.
 *
 *   bun run scripts/test-codex-refresh.ts [--write]
 *
 * By default this only READS the refresh_token, hits the OpenAI token
 * endpoint, and prints what came back — the DB is left untouched so a
 * successful call rotates the token upstream but the next production
 * request will find the OLD refresh_token on disk and 401. Pass
 * `--write` to persist the rotation via updateSubAccountAccessToken.
 * Without --write the diagnostic is safe to run once; running it twice
 * on a rotating provider WILL invalidate the token.
 */

import 'dotenv/config'
import { refreshCodexToken } from '../src/services/codex-auth/oauth'
import { getSubAccountTokensForKind, updateSubAccountAccessToken } from '../src/services/subscription-account-sync/read'

const write = process.argv.includes('--write')
console.error(`mode: ${write ? 'WRITE (DB will be updated on success)' : 'READ-ONLY (DB left as-is)'}`)

const codex = await getSubAccountTokensForKind('codex')
if (codex.length === 0) {
  console.error('no codex sub accounts registered')
  process.exit(0)
}

for (const acc of codex) {
  console.error('---')
  console.error(`subAccountId: ${acc.subAccountId}`)
  console.error(`displayName:  ${acc.displayName}`)
  console.error(`accountId:    ${acc.accountId ?? '(null)'}`)
  console.error(`expiresAt:    ${acc.expiresAt?.toISOString() ?? '(null)'}`)
  console.error(`accessToken len:  ${acc.accessToken.length}`)
  console.error(`refreshToken len: ${acc.refreshToken?.length ?? '(null)'}`)
  if (!acc.refreshToken || acc.refreshToken.length === 0) {
    console.error('SKIP: no refresh token stored')
    continue
  }
  const started = Date.now()
  try {
    const result = await refreshCodexToken({ refreshToken: acc.refreshToken })
    const elapsed = Date.now() - started
    console.error(`refresh OK in ${elapsed}ms`)
    console.error(`  access_token len:  ${result.access_token.length}`)
    console.error(`  refresh_token len: ${result.refresh_token.length}`)
    console.error(`  id_token:          ${result.id_token ? `present (len=${result.id_token.length})` : '(omitted)'}`)
    console.error(`  expires_in:        ${result.expires_in ?? '(omitted)'}`)
    const rotated = result.refresh_token !== acc.refreshToken
    console.error(`  refresh_token rotated: ${rotated}`)
    if (write) {
      const expiresInSec = result.expires_in !== undefined ? result.expires_in : 3600
      await updateSubAccountAccessToken(acc.subAccountId, {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: new Date(Date.now() + expiresInSec * 1000)
      })
      console.error('  DB updated with rotated tokens')
    }
  } catch (e) {
    const elapsed = Date.now() - started
    console.error(`refresh FAILED in ${elapsed}ms`)
    console.error(`  reason: ${e instanceof Error ? e.message : String(e)}`)
  }
}
process.exit(0)
