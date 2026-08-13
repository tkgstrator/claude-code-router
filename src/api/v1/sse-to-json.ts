/**
 * Re-export shim: the SSE→JSON aggregators live under
 * `src/llms/utils/sse-aggregate.ts` so both this /v1 route layer and
 * the openai-responses endpoint transformer can share them without
 * importing across the api ← llms boundary. Callers that already reach
 * for this path keep working; new callers should import directly from
 * the utils location.
 */

export {
  aggregateAnthropicSseToJson,
  aggregateOpenAiChatSseToJson,
  aggregateOpenAiResponsesSseToJson,
  isSseContentType
} from '../../llms/utils/sse-aggregate'
