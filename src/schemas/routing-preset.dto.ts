import { z } from '@hono/zod-openapi'
import { RouterConfigSchema } from './router.dto'

// Wire shape for a stored Router snapshot. `name` is a user-facing
// label with NO uniqueness constraint — id (uuid) is the identity, so
// two presets may share a display name and the client uses the id to
// disambiguate. `config` is a full RouterConfig snapshot: applying a
// preset just replaces the editor's draft state, so no cross-table
// integrity is required beyond "this parses as a RouterConfig".
export const RoutingPresetSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nonempty(),
    config: RouterConfigSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .openapi('RoutingPreset')
export type RoutingPreset = z.infer<typeof RoutingPresetSchema>

export const RoutingPresetListResponseSchema = z
  .object({
    presets: z.array(RoutingPresetSchema)
  })
  .openapi('RoutingPresetListResponse')
export type RoutingPresetListResponse = z.infer<typeof RoutingPresetListResponseSchema>

export const CreateRoutingPresetSchema = z
  .object({
    name: z.string().nonempty(),
    config: RouterConfigSchema
  })
  .openapi('CreateRoutingPreset')
export type CreateRoutingPreset = z.infer<typeof CreateRoutingPresetSchema>

// Both fields optional — rename without touching config, or overwrite
// config without renaming. The route rejects a body that sets neither.
export const UpdateRoutingPresetSchema = z
  .object({
    name: z.string().nonempty().optional(),
    config: RouterConfigSchema.optional()
  })
  .refine((v) => v.name !== undefined || v.config !== undefined, {
    message: 'At least one of name or config must be provided'
  })
  .openapi('UpdateRoutingPreset')
export type UpdateRoutingPreset = z.infer<typeof UpdateRoutingPresetSchema>

export const RoutingPresetIdParamSchema = z.object({
  id: z.uuid()
})
