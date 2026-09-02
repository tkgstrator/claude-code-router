/**
 * Per-account in-memory cache for the latest polled usage snapshot,
 * shared by the live-fetch and headroom modules. Module-private state,
 * exposed here so both halves of usage-service read/write the same map.
 */

import type { ClaudeUsage, CodexUsage } from '../../schemas/api/usage'
export const TTL_MS = 5 * 60_000

// Per-account cache keyed by subAccountId.
export const claudeCache = new Map<string, { value: ClaudeUsage; at: number }>()
export const codexCache = new Map<string, { value: CodexUsage; at: number }>()

// ---- Test seam (Phase 6 S1) ----------------------------------------
//
// The per-account caches are module-private and are normally only filled
// by the live fetch path. These helpers let unit tests seed and clear the
// cache so the window-selectable headroom functions can be covered without
// hitting the network. Not part of the routing API — test-only.
export function __seedClaudeCacheForTest(subAccountId: string, value: ClaudeUsage, at: number): void {
  claudeCache.set(subAccountId, { value, at })
}

export function __seedCodexCacheForTest(subAccountId: string, value: CodexUsage, at: number): void {
  codexCache.set(subAccountId, { value, at })
}

export function __clearUsageCachesForTest(): void {
  claudeCache.clear()
  codexCache.clear()
}
