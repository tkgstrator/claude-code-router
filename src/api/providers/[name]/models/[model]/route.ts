import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  UpdateModelBodySchema,
  UpdateModelErrorResponseSchema,
  UpdateModelSuccessResponseSchema
} from '../../../../../schemas'
import { setModelEnabled } from '../../../../../services/config'
import { ValidationErrorResponseSchema, validationErrorHook } from '../../../../zod-response'

export const providerModelRoute = new OpenAPIHono({ defaultHook: validationErrorHook })

const ProviderModelParamsSchema = z.object({
  name: z
    .string()
    .nonempty()
    .openapi({ param: { name: 'name', in: 'path' } }),
  model: z
    .string()
    .nonempty()
    .openapi({ param: { name: 'model', in: 'path' } })
})

const updateModelRoute = createRoute({
  method: 'patch',
  path: '/api/providers/{name}/models/{model}',
  request: {
    params: ProviderModelParamsSchema,
    body: { content: { 'application/json': { schema: UpdateModelBodySchema } } }
  },
  responses: {
    200: {
      description: 'Model enable/disable toggled.',
      content: { 'application/json': { schema: UpdateModelSuccessResponseSchema } }
    },
    400: {
      description: 'Validation failure — see issues[].',
      content: { 'application/json': { schema: ValidationErrorResponseSchema } }
    },
    404: {
      description: 'Provider or model not found.',
      content: { 'application/json': { schema: UpdateModelErrorResponseSchema } }
    }
  }
})

providerModelRoute.openapi(updateModelRoute, async (c) => {
  const { name, model } = c.req.valid('param')
  const { enabled } = c.req.valid('json')
  try {
    await setModelEnabled(name, model, enabled)
    return c.json({ success: true as const }, 200)
  } catch (err) {
    return c.json({ success: false as const, error: (err as Error).message }, 404)
  }
})
