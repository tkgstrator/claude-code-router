/**
 * Process-wide registry of transformer instances.
 *
 * Replaces the legacy TransformerService. Transformers are registered
 * up-front by the context builder (`src/llms/context.ts`), keyed by
 * their `name`. The pipeline asks the registry for:
 *   - a transformer by name (chain resolution, bypass detection),
 *   - the subset that own an `endPoint` (path-based dispatch in v1/route).
 */

import type { Logger } from 'pino'
import type { Transformer } from '../transformers/base'

export type TransformerWithName = {
  name: string
  transformer: Transformer
}

export class TransformerRegistry {
  private readonly map = new Map<string, Transformer>()

  constructor(private readonly logger?: Logger) {}

  register(transformer: Transformer): void {
    if (this.logger) transformer.setLogger(this.logger)
    this.map.set(transformer.name, transformer)
    this.logger?.info(
      `register transformer: ${transformer.name}${
        transformer.endPoint ? ` (endpoint: ${transformer.endPoint})` : ' (no endpoint)'
      }`
    )
  }

  registerMany(transformers: Transformer[]): void {
    for (const t of transformers) this.register(t)
  }

  get(name: string): Transformer | undefined {
    return this.map.get(name)
  }

  has(name: string): boolean {
    return this.map.has(name)
  }

  getAll(): Transformer[] {
    return Array.from(this.map.values())
  }

  /** Subset that owns a path the v1 adapter dispatches against. */
  getWithEndpoint(): TransformerWithName[] {
    const result: TransformerWithName[] = []
    for (const [name, transformer] of this.map) {
      if (transformer.endPoint) result.push({ name, transformer })
    }
    return result
  }
}
