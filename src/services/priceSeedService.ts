/**
 * Load the scraped official vendor prices
 * (packages/shared/src/data/providers/<vendor>/prices.json, surfaced as
 * OFFICIAL_VENDOR_PRICES) into the Model table for the three
 * first-party API vendors.
 *
 * Behaviour: for each of openai / anthropic / google (api_key auth
 * only), the Model catalog is reconciled to exactly the scraped set —
 * models the scrape no longer lists are deleted (their RouterSlot
 * binding nulled first so the FK Restrict doesn't abort), and every
 * scraped model is upserted with its USD/1M input+output price,
 * `deprecated` (from the deprecations registry) and `legacy` (from the
 * scrape) flags.
 *
 * Subscription providers (claude-code / codex, authMode=subscription)
 * are intentionally untouched — their pricing is plan-based, not
 * per-token, and the user manages those separately.
 */

import { isDeprecatedModel, OFFICIAL_VENDOR_PRICES, VENDOR_DEFAULTS } from '@ccr/shared/data'
import { getPrismaClient } from '../db/client'
import { AuthMode, Prisma, type PrismaClient } from '../generated/prisma/client'

const OFFICIAL_VENDORS = ['openai', 'anthropic', 'google'] as const

export interface PriceSeedOutcome {
  vendor: string
  created: number
  updated: number
  deleted: number
  skipped?: string
}

export async function seedScrapedPricesIntoDb(
  prisma: PrismaClient = getPrismaClient()
): Promise<PriceSeedOutcome[]> {
  const outcomes: PriceSeedOutcome[] = []

  for (const vendor of OFFICIAL_VENDORS) {
    const priceMap = OFFICIAL_VENDOR_PRICES[vendor] ?? {}
    const desiredIds = Object.keys(priceMap)
    if (desiredIds.length === 0) {
      outcomes.push({ vendor, created: 0, updated: 0, deleted: 0, skipped: 'no scraped prices' })
      continue
    }
    const defaults = VENDOR_DEFAULTS[vendor]

    const outcome = await prisma.$transaction(async (tx): Promise<PriceSeedOutcome> => {
      let provider = await tx.provider.findUnique({
        where: { name: vendor },
        include: { models: true }
      })
      if (!provider) {
        // Provider row absent (fresh DB before ensureSeedProviders, or
        // user removed it). Recreate as api_key with a blank key — the
        // user fills the key in from the UI.
        provider = await tx.provider.create({
          data: {
            name: vendor,
            apiBaseUrl: defaults?.baseUrl ?? '',
            apiKey: '',
            authMode: AuthMode.api_key,
            transformer: defaults?.transformer ?? Prisma.DbNull
          },
          include: { models: true }
        })
      }
      // Never touch a subscription-auth provider that happens to share
      // the name. (claude-code/codex use different names, so this is a
      // belt-and-braces guard.)
      if (provider.authMode !== AuthMode.api_key) {
        return { vendor, created: 0, updated: 0, deleted: 0, skipped: 'provider is subscription auth' }
      }

      const desiredSet = new Set(desiredIds)
      const stale = provider.models.filter((m) => !desiredSet.has(m.name)).map((m) => m.name)

      let deleted = 0
      if (stale.length > 0) {
        await tx.routerSlot.updateMany({
          where: { model: { providerId: provider.id, name: { in: stale } } },
          data: { modelId: null }
        })
        const res = await tx.model.deleteMany({
          where: { providerId: provider.id, name: { in: stale } }
        })
        deleted = res.count
      }

      const existingNames = new Set(provider.models.map((m) => m.name))
      let created = 0
      let updated = 0
      for (const id of desiredIds) {
        const entry = priceMap[id]
        const data = {
          deprecated: isDeprecatedModel(id),
          legacy: Boolean(entry.legacy),
          inputPer1M: entry.inputPer1M,
          outputPer1M: entry.outputPer1M
        }
        if (existingNames.has(id)) {
          await tx.model.update({
            where: { providerId_name: { providerId: provider.id, name: id } },
            data
          })
          updated++
        } else {
          await tx.model.create({
            data: { providerId: provider.id, name: id, ...data }
          })
          created++
        }
      }
      return { vendor, created, updated, deleted }
    })
    outcomes.push(outcome)
  }

  return outcomes
}
