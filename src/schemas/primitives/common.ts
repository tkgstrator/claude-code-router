/**
 * Scalars and enums with no layer of their own: they are composed into
 * wire, domain and api schemas alike, so they cannot live in any one of
 * them without creating an upward dependency.
 */

import { z } from '@hono/zod-openapi'

// React Hook Form uses '' for unset fields; this coerces '' → null so DB-level
// "nonempty or null" constraints are satisfied without client-side workarounds.
// preprocess keeps input type as string | null; pipe validates the result.
export const EmptyStringToNullSchema = z
  .string()
  .nullable()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().nonempty().nullable())

export const AccessLevelSchema = z.enum(['restricted', 'full'])
export type AccessLevel = z.infer<typeof AccessLevelSchema>
