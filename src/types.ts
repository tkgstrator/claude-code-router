import { z } from 'zod'
import { ProviderSchema } from '@/schemas'

export type { Provider, ProviderAuthMode, ProviderTransformer } from '@/schemas'
export { ProviderAuthModeSchema, ProviderSchema, ProviderTransformerSchema } from '@/schemas'

export const RouterConfigSchema = z.object({
  default: z.string().nullable(),
  background: z.string().nullable(),
  think: z.string().nullable(),
  longContext: z.string().nullable(),
  longContextThreshold: z.number(),
  webSearch: z.string().nullable(),
  image: z.string().nullable(),
  custom: z.unknown().optional()
})

export const TransformerSchema = z.object({
  name: z.string().nonempty().optional(),
  path: z.string().nonempty(),
  options: z.record(z.string().nonempty(), z.any()).optional()
})

export const StatusLineModuleConfigSchema = z.object({
  type: z.string().nonempty(),
  icon: z.string().nonempty().optional(),
  text: z.string().nonempty(),
  color: z.string().nonempty().optional(),
  background: z.string().nonempty().optional(),
  scriptPath: z.string().nonempty().optional()
})

export const StatusLineThemeConfigSchema = z.object({
  modules: z.array(StatusLineModuleConfigSchema)
})

export const StatusLineConfigSchema = z.object({
  enabled: z.boolean(),
  currentStyle: z.string().nonempty(),
  default: StatusLineThemeConfigSchema,
  powerline: StatusLineThemeConfigSchema,
  fontFamily: z.string().nonempty().optional()
})

export const ConfigSchema = z.object({
  Providers: z.array(ProviderSchema),
  Router: RouterConfigSchema,
  transformers: z.array(TransformerSchema),
  StatusLine: StatusLineConfigSchema.optional(),
  forceUseImageAgent: z.boolean().optional(),
  LOG: z.boolean(),
  LOG_LEVEL: z.string().nonempty(),
  CLAUDE_PATH: z.string().nonempty(),
  HOST: z.string().nonempty(),
  PORT: z.number(),
  APIKEY: z.string().nonempty(),
  API_TIMEOUT_MS: z.number().int().nonnegative(),
  PROXY_URL: z.url(),
  CUSTOM_ROUTER_PATH: z.string().nonempty().optional()
})

export const AccessLevelSchema = z.enum(['restricted', 'full'])

export type RouterConfig = z.infer<typeof RouterConfigSchema>
export type Transformer = z.infer<typeof TransformerSchema>
export type StatusLineModuleConfig = z.infer<typeof StatusLineModuleConfigSchema>
export type StatusLineThemeConfig = z.infer<typeof StatusLineThemeConfigSchema>
export type StatusLineConfig = z.infer<typeof StatusLineConfigSchema>
export type Config = z.infer<typeof ConfigSchema>
export type AccessLevel = z.infer<typeof AccessLevelSchema>
