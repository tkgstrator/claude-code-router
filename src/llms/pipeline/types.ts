/**
 * Shared pipeline types.
 *
 * Split out so the sub-modules under `src/llms/pipeline/` can import
 * `PipelineDeps` / `PipelineInput` without a runtime circular import back
 * through the top-level `pipeline.ts` (which re-exports them for
 * external callers).
 */

import type { Logger } from 'pino'
import type { MessageRecord, TransformerContext, UsageRecord } from '@/schemas'
import type { ResolvedProvider } from '../registry/provider'
import type { Transformer } from '../transformers/base'

export type PipelineDeps = {
  log: Logger
  /** Outbound HTTPS proxy URL, if any. */
  httpsProxy?: string
  /** Hook to write a usage row to the request_logs table (best-effort). */
  recordUsage?: (entry: UsageRecord) => Promise<void>
  /** Hook to append rows to the Message table (best-effort). Called
   *  once with the last user block on request send, and once with the
   *  assembled assistant blocks after the response stream completes. */
  recordMessages?: (entries: MessageRecord[]) => Promise<void>
}

export type PipelineInput = {
  /** Raw inbound request body. */
  body: Record<string, unknown>
  /** Inbound headers (case-preserved as the upstream client sent them). */
  headers: Record<string, string>
  /** Resolved provider for this request. */
  provider: ResolvedProvider
  /** Endpoint transformer the v1 adapter dispatched against. */
  transformer: Transformer
  /** Transformer-side context shared with hooks (must carry `req` for
   *  session-id sniffing and log correlation). */
  context: TransformerContext
}
