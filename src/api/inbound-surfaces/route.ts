/**
 * GET/POST /api/inbound-surfaces — per-surface routing mode.
 *
 * The read returns every surface in the registry, whether or not an
 * operator has overridden it, so the Routing screen can show the full set
 * with its effective mode. `overridden` says which rows are the operator's
 * choice versus the shipped default.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { listSurfaces, updateSurface } from '../../services/inbound-surface-service'

const SurfaceIdSchema = z.enum(['anthropic-messages', 'openai-chat', 'openai-responses', 'gemini-generate'])

const SurfaceSchema = z
  .object({
    id: SurfaceIdSchema,
    path: z.string().nonempty(),
    client: z.string().nonempty(),
    inboundType: z.enum(['anthropic', 'openai', 'gemini']),
    auth: z.enum(['x-api-key', 'bearer', 'google']),
    errorShape: z.enum(['anthropic', 'openai', 'google']),
    routingMode: z.enum(['routed', 'passthrough']),
    defaultRoutingMode: z.enum(['routed', 'passthrough']),
    profileKey: z.string().nonempty(),
    overridden: z.boolean()
  })
  .openapi('InboundSurface')

const ListResponseSchema = z.object({ surfaces: z.array(SurfaceSchema) }).openapi('InboundSurfacesResponse')

const UpdateBodySchema = z
  .object({
    surface: SurfaceIdSchema,
    routingMode: z.enum(['routed', 'passthrough']),
    profileKey: z.string().nonempty().nullable().optional()
  })
  .openapi('InboundSurfaceUpdate')

export const inboundSurfacesRoute = new OpenAPIHono()

inboundSurfacesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/api/inbound-surfaces',
    responses: {
      200: {
        description: 'Every inbound surface with its effective routing mode',
        content: { 'application/json': { schema: ListResponseSchema } }
      }
    }
  }),
  async (c) => c.json({ surfaces: await listSurfaces() }, 200)
)

inboundSurfacesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/api/inbound-surfaces',
    request: { body: { content: { 'application/json': { schema: UpdateBodySchema } } } },
    responses: {
      200: {
        description: 'Surface updated; returns the full refreshed list',
        content: { 'application/json': { schema: ListResponseSchema } }
      }
    }
  }),
  async (c) => {
    const body = c.req.valid('json')
    return c.json({ surfaces: await updateSurface(body) }, 200)
  }
)
