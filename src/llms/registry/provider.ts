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
import { type ProviderConfigShape, RecordSchema, type RuntimeProvider, type TransformerUseEntry } from '@/schemas'
import type { Transformer, TransformerConstructor } from '../transformers/base'
import type { TransformerRegistry } from './transformer'

/** Provider shape after `use` entries have been resolved to instances.
 *  Structurally compatible with RuntimeProvider (transformer.use is
 *  Transformer[], a subtype of unknown[]), so the pipeline can pass
 *  these straight into transformer hooks. */
export type ResolvedProvider = Omit<RuntimeProvider, 'transformer'> & {
  transformer?: ResolvedProviderTransformer
}

export type ResolvedProviderTransformer = {
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
      // ProviderConfigShape requires name/api_base_url/api_key as nonempty
      // strings already; this is a defence-in-depth check for callers that
      // hand us pre-parse-equivalent data. Surface the skip so a missing
      // api_key doesn't silently translate to "provider not found" later
      // in the chain walker — scenario-router also filters these out, but
      // the warn is the loudest signal that the row needs an api_key.
      if (!config.name || !config.api_base_url || !config.api_key) {
        const missing = [
          !config.name && 'name',
          !config.api_base_url && 'api_base_url',
          !config.api_key && 'api_key'
        ].filter((s): s is string => typeof s === 'string')
        this.logger?.warn(
          { provider: config.name, missing },
          `provider '${config.name}' skipped — missing required fields: ${missing.join(', ')}`
        )
        continue
      }
      try {
        this.providers.set(config.name, this.resolve(config))
        this.logger?.info(`${config.name} provider registered`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger?.error(
          { err: error, provider: config.name },
          `${config.name} provider registered error: ${message}`
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
      // ProviderConfigShape.models has a Zod .default([]) so a missing
      // array becomes [] after parse — the schema-typed input may still
      // surface undefined for raw callers (z.input side), hence this
      // explicit normalisation rather than trusting the input.
      models: config.models ? config.models : []
    }
    if (!config.transformer) return resolved

    resolved.transformer = this.resolveTransformerBlock(config.transformer)
    return resolved
  }

  private resolveTransformerBlock(block: Record<string, unknown>): ResolvedProviderTransformer {
    const out: ResolvedProviderTransformer = {}
    for (const [key, value] of Object.entries(block)) {
      if (key === 'use') {
        if (isUseEntryList(value)) out.use = this.resolveUseList(value)
        continue
      }
      if (isModelOverride(value) && isUseEntryList(value.use)) {
        out[key] = { use: this.resolveUseList(value.use) }
        continue
      }
      // Preserve unknown keys verbatim (e.g. subscriptionCredentialPath,
      // subscriptionAuth) — the OAuth base reads them off provider.transformer.
      out[key] = value
    }
    return out
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
      // Legacy CTOR-with-options path: the constructor signature is the
      // TransformerConstructor contract on the base class side. The 6
      // shipped transformers don't take options today, but the path
      // stays open for future ones.
      const Ctor = base.constructor as unknown as TransformerConstructor
      try {
        return new Ctor(entry[1])
      } catch {
        return base
      }
    }
    return undefined
  }
}

function isUseEntryList(value: unknown): value is TransformerUseEntry[] {
  return Array.isArray(value)
}

function isModelOverride(value: unknown): value is { use: unknown[] } {
  const parsed = RecordSchema.safeParse(value)
  if (!parsed.success) return false
  return 'use' in parsed.data && Array.isArray(parsed.data.use)
}
