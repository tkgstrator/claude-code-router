import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { BUILTIN_TRANSFORMERS } from '../../lib/builtinTransformers'
import { TransformersResponseSchema } from '../../schemas'

export const transformersRoute = new OpenAPIHono()

const getTransformersRoute = createRoute({
  method: 'get',
  path: '/api/transformers',
  responses: {
    200: {
      description: 'Built-in transformers registered on the server',
      content: { 'application/json': { schema: TransformersResponseSchema } }
    }
  }
})
transformersRoute.openapi(getTransformersRoute, (c) => {
  // Mirrors the list @musistudio/llms registers at boot. Once we
  // bootstrap TransformerService from Hono we can read it directly.
  return c.json({ transformers: BUILTIN_TRANSFORMERS }, 200)
})
