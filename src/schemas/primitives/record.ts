/**
 * Generic "unknown object" shape. Use `RecordSchema.parse(value)` instead
 * of casting to `Record<string, unknown>` at trust boundaries (parsed
 * JSON bodies, opaque transformer payloads, etc.).
 */

import { z } from '@hono/zod-openapi'

export const RecordSchema = z.record(z.string().nonempty(), z.unknown())
export type UnknownRecord = z.infer<typeof RecordSchema>
