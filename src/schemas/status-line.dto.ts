import { z } from '@hono/zod-openapi'

export const StatusLineModuleConfigSchema = z.object({
  type: z.string().nonempty(),
  icon: z.string().nonempty().optional(),
  text: z.string().nonempty(),
  color: z.string().nonempty().optional(),
  background: z.string().nonempty().optional(),
  scriptPath: z.string().nonempty().optional()
})
export type StatusLineModuleConfig = z.infer<typeof StatusLineModuleConfigSchema>

export const StatusLineThemeConfigSchema = z.object({
  modules: z.array(StatusLineModuleConfigSchema)
})
export type StatusLineThemeConfig = z.infer<typeof StatusLineThemeConfigSchema>

export const StatusLineConfigSchema = z.object({
  enabled: z.boolean(),
  currentStyle: z.string().nonempty(),
  default: StatusLineThemeConfigSchema,
  powerline: StatusLineThemeConfigSchema,
  fontFamily: z.string().nonempty().optional()
})
export type StatusLineConfig = z.infer<typeof StatusLineConfigSchema>
