import type { ThinkLevel } from '@/schemas/domain/unified'
/**
 * Map a raw Anthropic-style `thinking_budget` token count onto the
 * coarse `ThinkLevel` bucket the pipeline understands.
 */
export const getThinkLevel = (thinking_budget: number): ThinkLevel => {
  if (thinking_budget <= 0) return 'none'
  if (thinking_budget <= 1024) return 'low'
  if (thinking_budget <= 8192) return 'medium'
  return 'high'
}
