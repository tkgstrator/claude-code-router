import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { ModelTestRequestSchema, ModelTestResultSchema } from '../../../schemas'
import { testModel } from '../../../services/model-test-service'

export const modelTestRoute = new OpenAPIHono()

const route = createRoute({
  method: 'post',
  path: '/api/models/test',
  request: {
    body: {
      content: { 'application/json': { schema: ModelTestRequestSchema } },
      required: true
    }
  },
  responses: {
    200: {
      description: 'Real-inference connectivity test result for one model',
      content: { 'application/json': { schema: ModelTestResultSchema } }
    }
  }
})
modelTestRoute.openapi(route, async (c) => {
  const { provider, model } = c.req.valid('json')
  const result = await testModel(provider, model)
  return c.json(result, 200)
})
