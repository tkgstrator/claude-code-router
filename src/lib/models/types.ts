export type Reachability = 'unknown' | 'testing' | 'ok' | 'fail'

export interface ModelRow {
  provider: string
  model: string
  key: string
  enabled: boolean
  isSubscription: boolean
  contextWindow?: number
  // USD/1M prices straight from the DB (scraped/seeded) via the config
  // payload — no static-bundle fallback. null = vendor publishes no price
  // for that leg; undefined = the model isn't in modelPrices at all.
  inputPer1M?: number | null
  outputPer1M?: number | null
}

export type SortKey = 'provider' | 'model' | 'input' | 'output'
