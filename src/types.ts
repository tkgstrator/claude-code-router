import { z } from 'zod'

export const ProviderTransformerSchema = z
  .object({
    use: z.array(
      z.union([
        z.string().nonempty(),
        z.array(z.union([z.string().nonempty(), z.record(z.string().nonempty(), z.unknown())]))
      ])
    )
  })
  .catchall(z.any())

export const ProviderAuthModeSchema = z.enum(['api_key', 'subscription'])

export const ProviderSchema = z.object({
  name: z.string().nonempty(),
  api_base_url: z.url(),
  api_key: z.string().nonempty(),
  auth_mode: ProviderAuthModeSchema.optional(),
  models: z.array(z.string().nonempty()),
  deprecatedModels: z.array(z.string().nonempty()).default([]),
  modelTestStatus: z
    .record(
      z.string().nonempty(),
      z.object({
        status: z.enum(['unknown', 'ok', 'fail']),
        passedAt: z.string().nullable()
      })
    )
    .optional(),
  modelContextWindows: z.record(z.string().nonempty(), z.number()).optional(),
  transformer: ProviderTransformerSchema.optional()
})

export const RouterConfigSchema = z.object({
  default: z.string().nonempty(),
  background: z.string().nonempty(),
  think: z.string().nonempty(),
  longContext: z.string().nonempty(),
  longContextThreshold: z.number(),
  webSearch: z.string().nonempty(),
  image: z.string().nonempty(),
  custom: z.unknown().optional()
})

export const TransformerSchema = z.object({
  name: z.string().optional(),
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
  API_TIMEOUT_MS: z.string().nonempty(),
  PROXY_URL: z.url(),
  CUSTOM_ROUTER_PATH: z.string().nonempty().optional()
})

export const AccessLevelSchema = z.enum(['restricted', 'full'])

export type ProviderTransformer = z.infer<typeof ProviderTransformerSchema>
export type ProviderAuthMode = z.infer<typeof ProviderAuthModeSchema>
export type Provider = z.infer<typeof ProviderSchema>
export type RouterConfig = z.infer<typeof RouterConfigSchema>
export type Transformer = z.infer<typeof TransformerSchema>
export type StatusLineModuleConfig = z.infer<typeof StatusLineModuleConfigSchema>
export type StatusLineThemeConfig = z.infer<typeof StatusLineThemeConfigSchema>
export type StatusLineConfig = z.infer<typeof StatusLineConfigSchema>
export type Config = z.infer<typeof ConfigSchema>
export type AccessLevel = z.infer<typeof AccessLevelSchema>
