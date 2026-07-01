import { z } from '@hono/zod-openapi'

// One model row inside a catalog entry. Optional numeric fields are
// null when the vendor doesn't publish the field on its pricing page.
export const CatalogModelSchema = z
  .object({
    name: z.string().nonempty(),
    inputPer1M: z.number().nullable(),
    outputPer1M: z.number().nullable(),
    cachedInputPer1M: z.number().nullable(),
    contextWindow: z.number().int().nullable(),
    legacy: z.boolean(),
    deprecated: z.boolean()
  })
  .openapi('CatalogModel')

// A single vendor entry in the catalog. `enabled` reflects whether a
// Provider row with this name currently exists in the DB. The UI uses
// this to decide whether to render an "Enable" button (catalog view) or
// an editor (configured view).
export const CatalogEntrySchema = z
  .object({
    name: z.string().nonempty(),
    displayName: z.string().nonempty(),
    authMode: z.enum(['api_key', 'subscription']),
    apiBaseUrl: z.string().nonempty(),
    vendor: z.string().nonempty(),
    // subscription-preset-specific fields; null for api_key vendors.
    cli: z.string().nonempty().nullable(),
    credentialsPath: z.string().nonempty().nullable(),
    defaultEnabledModels: z.array(z.string().nonempty()),
    models: z.array(CatalogModelSchema),
    enabled: z.boolean(),
    // ISO 8601 timestamp of the last scrape overlay that touched this
    // vendor's price data (null if only static seed has been used).
    lastRefreshedAt: z.string().nonempty().nullable()
  })
  .openapi('CatalogEntry')

export const CatalogResponseSchema = z
  .object({
    entries: z.array(CatalogEntrySchema)
  })
  .openapi('CatalogResponse')

export const CatalogRefreshResponseSchema = z
  .object({
    entries: z.array(CatalogEntrySchema),
    scrapedVendors: z.array(z.string().nonempty()),
    // Empty on success. One line per failed vendor with the reason;
    // partial success is still 200 so the UI can render whatever landed.
    warnings: z.array(z.string().nonempty())
  })
  .openapi('CatalogRefreshResponse')
