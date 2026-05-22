import type { getPrismaClient } from '../db/client'

export type PriceEntry = {
  inputPer1M: number | null
  outputPer1M: number | null
  cachedInputPer1M: number | null
}

export async function buildPriceMap(
  prisma: ReturnType<typeof getPrismaClient>,
  pairs: string[]
): Promise<Map<string, PriceEntry>> {
  if (pairs.length === 0) return new Map()

  const modelNames = [...new Set(pairs.map((p) => p.slice(p.indexOf('||') + 2)))]

  const rows = await prisma.model.findMany({
    where: {
      OR: [
        ...pairs.map((p) => {
          const sep = p.indexOf('||')
          return { name: p.slice(sep + 2), provider: { name: p.slice(0, sep) } }
        }),
        { name: { in: modelNames }, inputPer1M: { not: null } }
      ]
    },
    select: {
      name: true,
      inputPer1M: true,
      outputPer1M: true,
      cachedInputPer1M: true,
      provider: { select: { name: true } }
    }
  })

  const map = new Map<string, PriceEntry>()
  const fallback = new Map<string, PriceEntry>()
  for (const m of rows) {
    map.set(`${m.provider.name}||${m.name}`, m)
    if (m.inputPer1M != null && !fallback.has(m.name)) fallback.set(m.name, m)
  }

  for (const pair of pairs) {
    const existing = map.get(pair)
    if (!existing || existing.inputPer1M == null) {
      const modelName = pair.slice(pair.indexOf('||') + 2)
      const fb = fallback.get(modelName)
      if (fb) map.set(pair, fb)
    }
  }

  return map
}

export function computeCosts(
  log: {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  },
  priceMap: Map<string, PriceEntry>
) {
  const price = priceMap.get(`${log.provider}||${log.model}`)
  const inputCostUsd = price?.inputPer1M != null ? (log.inputTokens / 1_000_000) * price.inputPer1M : null
  const outputCostUsd = price?.outputPer1M != null ? (log.outputTokens / 1_000_000) * price.outputPer1M : null
  const cacheReadCostUsd =
    price?.cachedInputPer1M != null ? (log.cacheReadTokens / 1_000_000) * price.cachedInputPer1M : null
  const cacheWriteCostUsd =
    price?.inputPer1M != null ? (log.cacheWriteTokens / 1_000_000) * price.inputPer1M * 1.25 : null
  const totalCostUsd =
    inputCostUsd != null && outputCostUsd != null
      ? inputCostUsd + outputCostUsd + (cacheReadCostUsd ?? 0) + (cacheWriteCostUsd ?? 0)
      : null
  return { inputCostUsd, outputCostUsd, cacheReadCostUsd, totalCostUsd }
}
