// The price-scrape endpoints. The scraped prices themselves land on
// Model rows; only the per-vendor outcome of a run is an api shape.

import { z } from '@hono/zod-openapi'

export const ScrapePricesVendorSchema = z.enum(['openai', 'anthropic', 'google', 'all']).openapi('ScrapePricesVendor')

// Per-vendor result of seedScrapedPricesIntoDb: how many Model rows
// were created / updated / deleted, or why the vendor was skipped.
export const PriceSeedOutcomeSchema = z
  .object({
    vendor: z.string().nonempty(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    skipped: z.string().nonempty().optional()
  })
  .openapi('PriceSeedOutcome')
