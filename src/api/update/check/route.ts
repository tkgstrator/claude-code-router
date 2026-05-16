import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { APP_VERSION } from '../../../lib/version'
import { UpdateCheckResponseSchema } from '../../../schemas'
import { checkForUpdates } from '../../../services/update'

export const updateCheckRoute = new OpenAPIHono()

const route = createRoute({
  method: 'get',
  path: '/api/update/check',
  responses: {
    200: {
      description: 'Compares the installed version against the npm registry',
      content: { 'application/json': { schema: UpdateCheckResponseSchema } }
    }
  }
})
updateCheckRoute.openapi(route, async (c) => {
  const result = await checkForUpdates(APP_VERSION)
  return c.json(result, 200)
})
