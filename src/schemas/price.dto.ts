import { z } from '@hono/zod-openapi'

export const ScrapePricesVendorSchema = z.enum(['openai', 'anthropic', 'google', 'all']).openapi('ScrapePricesVendor')
