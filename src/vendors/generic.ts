/**
 * Fallback vendor provider for vendors Rialto knows about (they live in
 * VENDOR_DEFAULTS) but hasn't yet grown a dedicated scraper. Delivers
 * live-models fetch through the base class using the endpoint /
 * modelsAuth pulled from VENDOR_DEFAULTS, and returns an empty scrape.
 *
 * Registry.getVendorProvider falls back here for any name that has a
 * VENDOR_DEFAULTS entry but no explicit subclass yet — so
 * google/xai/mistral/qwen/... keep working without a class-per-vendor
 * ramp.
 */

import { VENDOR_DEFAULTS } from '@/shared'
import { type ModelsAuth, VendorProvider } from './base'

export class GenericProvider extends VendorProvider {
  readonly vendor: string
  protected readonly modelsEndpoint: string | null
  protected readonly modelsAuth: ModelsAuth | null

  constructor(name: string) {
    super()
    const defaults = VENDOR_DEFAULTS[name]
    if (defaults === undefined) {
      throw new Error(`GenericProvider("${name}") has no VENDOR_DEFAULTS entry`)
    }
    this.vendor = name
    this.modelsEndpoint = defaults.modelsEndpoint === undefined ? null : defaults.modelsEndpoint
    this.modelsAuth = defaults.modelsAuth === undefined ? null : defaults.modelsAuth
  }
}
