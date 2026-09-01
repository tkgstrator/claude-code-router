// The self-update check/perform endpoints.

import { z } from '@hono/zod-openapi'

export const UpdateCheckResponseSchema = z
  .object({
    hasUpdate: z.boolean(),
    latestVersion: z.string().optional(),
    changelog: z.string().optional()
  })
  .openapi('UpdateCheckResponse')

export const UpdatePerformResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string().nonempty()
  })
  .openapi('UpdatePerformResponse')
