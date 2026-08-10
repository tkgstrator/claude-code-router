import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  CreateRoutingPresetSchema,
  RoutingPresetIdParamSchema,
  RoutingPresetListResponseSchema,
  RoutingPresetSchema,
  UpdateRoutingPresetSchema
} from '../../schemas'
import {
  createRoutingPreset,
  deleteRoutingPreset,
  listRoutingPresets,
  updateRoutingPreset
} from '../../services/routing-preset'
import { ValidationErrorResponseSchema, validationErrorHook } from '../zod-response'

export const routingPresetsRoute = new OpenAPIHono({ defaultHook: validationErrorHook })

const listRoute = createRoute({
  method: 'get',
  path: '/api/routing-presets',
  responses: {
    200: {
      description: 'All saved Router snapshots, newest-updated first.',
      content: { 'application/json': { schema: RoutingPresetListResponseSchema } }
    }
  }
})

routingPresetsRoute.openapi(listRoute, async (c) => {
  const presets = await listRoutingPresets()
  return c.json({ presets }, 200)
})

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/routing-presets',
  request: {
    body: { content: { 'application/json': { schema: CreateRoutingPresetSchema } } }
  },
  responses: {
    201: {
      description: 'The created preset row.',
      content: { 'application/json': { schema: RoutingPresetSchema } }
    },
    400: {
      description: 'Validation failure — see issues[].',
      content: { 'application/json': { schema: ValidationErrorResponseSchema } }
    }
  }
})

routingPresetsRoute.openapi(createRouteDef, async (c) => {
  const data = c.req.valid('json')
  const preset = await createRoutingPreset(data)
  return c.json(preset, 201)
})

const NotFoundSchema = z.object({ error: z.string().nonempty() })

const patchRoute = createRoute({
  method: 'patch',
  path: '/api/routing-presets/{id}',
  request: {
    params: RoutingPresetIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateRoutingPresetSchema } } }
  },
  responses: {
    200: {
      description: 'The updated preset row.',
      content: { 'application/json': { schema: RoutingPresetSchema } }
    },
    404: {
      description: 'No preset with that id.',
      content: { 'application/json': { schema: NotFoundSchema } }
    },
    400: {
      description: 'Validation failure — see issues[].',
      content: { 'application/json': { schema: ValidationErrorResponseSchema } }
    }
  }
})

routingPresetsRoute.openapi(patchRoute, async (c) => {
  const { id } = c.req.valid('param')
  const data = c.req.valid('json')
  const preset = await updateRoutingPreset(id, data)
  if (preset === null) return c.json({ error: 'preset not found' }, 404)
  return c.json(preset, 200)
})

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/api/routing-presets/{id}',
  request: { params: RoutingPresetIdParamSchema },
  responses: {
    204: { description: 'Deleted.' },
    404: {
      description: 'No preset with that id.',
      content: { 'application/json': { schema: NotFoundSchema } }
    }
  }
})

routingPresetsRoute.openapi(deleteRouteDef, async (c) => {
  const { id } = c.req.valid('param')
  const ok = await deleteRoutingPreset(id)
  if (!ok) return c.json({ error: 'preset not found' }, 404)
  return c.body(null, 204)
})
