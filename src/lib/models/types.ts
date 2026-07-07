export type Reachability = 'unknown' | 'testing' | 'ok' | 'fail'

export interface ModelRow {
  provider: string
  model: string
  key: string
  enabled: boolean
  isSubscription: boolean
  deprecated: boolean
  contextWindow?: number
}

export type SortKey = 'provider' | 'model' | 'input' | 'output'
