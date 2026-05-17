// Built-in transformer registry mirrored from
// packages/core/src/transformer/index.ts. Pulled in by the Hono root
// to serve GET /api/transformers without instantiating the full
// @musistudio/llms Server stack. When the legacy Server bootstrap goes
// away (later phase) we can swap this for a direct call into a Hono-
// compatible TransformerService factory.

interface BuiltinTransformer {
  name: string
  endpoint: string | null
}

export const BUILTIN_TRANSFORMERS: BuiltinTransformer[] = [
  { name: 'anthropic', endpoint: '/v1/messages' },
  { name: 'gemini', endpoint: '/v1beta/models/:modelAndAction' },
  { name: 'vertex-gemini', endpoint: null },
  { name: 'vertex-claude', endpoint: null },
  { name: 'deepseek', endpoint: null },
  { name: 'tooluse', endpoint: null },
  { name: 'openrouter', endpoint: null },
  { name: 'openai', endpoint: '/v1/chat/completions' },
  { name: 'maxtoken', endpoint: null },
  { name: 'groq', endpoint: null },
  { name: 'cleancache', endpoint: null },
  { name: 'enhancetool', endpoint: null },
  { name: 'reasoning', endpoint: null },
  { name: 'sampling', endpoint: null },
  { name: 'maxcompletiontokens', endpoint: null },
  { name: 'cerebras', endpoint: null },
  { name: 'streamoptions', endpoint: null },
  { name: 'customparams', endpoint: null },
  { name: 'vercel', endpoint: '/v1/chat/completions' },
  { name: 'openai-responses', endpoint: '/v1/responses' },
  { name: 'forcereasoning', endpoint: null },
  { name: 'claude-code-oauth', endpoint: '/v1/messages' }
]
