/**
 * Process-wide registry of runtime providers.
 *
 * Replaces the legacy ProviderService. Built from the `Providers[]` slice
 * of AppConfig at boot. The `transformer.use` entries (`string` or
 * `[name, opts]`) are resolved against the TransformerRegistry on
 * registration, producing the array of Transformer instances the
 * pipeline iterates at request time.
 */

import type { Logger } from 'pino'
import type { Transformer, TransformerConstructor } from '../transformers/base'
import type { ProviderConfigShape, RuntimeProvider, TransformerUseEntry } from '../types'
import type { TransformerRegistry } from './transformer'

/** Provider shape after `use` entries have been resolved to instances.
 *  Structurally compatible with RuntimeProvider (transformer.use is
 *  Transformer[], a subtype of unknown[]), so the pipeline can pass
 *  these straight into transformer hooks. */
export interface ResolvedProvider extends Omit<RuntimeProvider, 'transformer'> {
  transformer?: ResolvedProviderTransformer
}

export interface ResolvedProviderTransformer {
  use?: Transformer[]
  /** Per-model overrides keyed by model id, plus runtime-injected
   *  fields like subscriptionCredentialPath / subscriptionAuth. */
  [modelOrKey: string]: { use?: Transformer[] } | Transformer[] | unknown
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ResolvedProvider>()

  constructor(
    private readonly transformers: TransformerRegistry,
    private readonly logger?: Logger
  ) {}

  registerFromConfig(providers: ProviderConfigShape[]): void {
    for (const config of providers) {
      try {
        if (!config.name || !config.api_base_url || !config.api_key) continue
        this.providers.set(config.name, this.resolve(config))
        this.logger?.info(`${config.name} provider registered`)
      } catch (error) {
        this.logger?.error(
          { err: error, provider: config.name },
          `${config.name} provider registered error: ${(error as Error)?.message ?? String(error)}`
        )
      }
    }
  }

  get(name: string): ResolvedProvider | undefined {
    return this.providers.get(name)
  }

  getAll(): ResolvedProvider[] {
    return Array.from(this.providers.values())
  }

  private resolve(config: ProviderConfigShape): ResolvedProvider {
    const resolved: ResolvedProvider = {
      name: config.name,
      api_base_url: config.api_base_url,
      api_key: config.api_key,
      models: config.models ?? []
    }
    if (!config.transformer) return resolved

    resolved.transformer = this.resolveTransformerBlock(config.transformer)
    return resolved
  }

  private resolveTransformerBlock(block: Record<string, unknown>): ResolvedProviderTransformer {
    const out: ResolvedProviderTransformer = {}
    for (const key of Object.keys(block)) {
      const value = block[key]
      if (key === 'use') {
        if (Array.isArray(value)) {
          out.use = this.resolveUseList(value as TransformerUseEntry[])
        }
      } else if (this.isModelOverride(value)) {
        const sub = value.use
        if (Array.isArray(sub)) {
          out[key] = { use: this.resolveUseList(sub as TransformerUseEntry[]) }
        }
      } else {
        // Preserve unknown keys verbatim (e.g. subscriptionCredentialPath,
        // subscriptionAuth) — the OAuth base reads them off provider.transformer.
        out[key] = value
      }
    }
    return out
  }

  private isModelOverride(value: unknown): value is { use: unknown[] } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'use' in (value as Record<string, unknown>) &&
      Array.isArray((value as { use: unknown }).use)
    )
  }

  private resolveUseList(entries: TransformerUseEntry[]): Transformer[] {
    const out: Transformer[] = []
    for (const entry of entries) {
      const instance = this.resolveUseEntry(entry)
      if (instance) out.push(instance)
    }
    return out
  }

  private resolveUseEntry(entry: TransformerUseEntry): Transformer | undefined {
    if (typeof entry === 'string') {
      return this.transformers.get(entry)
    }
    if (Array.isArray(entry) && typeof entry[0] === 'string') {
      const base = this.transformers.get(entry[0])
      if (!base) return undefined
      // If the legacy code instantiated a CTOR for the per-call options
      // form, mirror that: cast through TransformerConstructor for the
      // few transformers that opt into it. The 6 we ship don't take
      // options today, but the path stays open for future ones.
      const Ctor = base.constructor as TransformerConstructor
      try {
        return new Ctor(entry[1])
      } catch {
        return base
      }
    }
    return undefined
  }
}
