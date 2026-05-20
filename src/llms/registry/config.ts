/**
 * Pipeline-scoped key/value store.
 *
 * Replaces the legacy ConfigService class. The pipeline only needs to
 * read scalars / objects keyed by name — there's no file loading or env
 * interpolation here (the envelope is handled by services/config/envelope.ts
 * upstream). Strict TS; callers pass a typed default so `T` is inferred.
 */

export type ConfigInit = {
  [key: string]: unknown
}

export class ConfigStore {
  private values: Map<string, unknown>

  constructor(initial: ConfigInit = {}) {
    this.values = new Map(Object.entries(initial))
  }

  get<T>(key: string): T | undefined
  get<T>(key: string, defaultValue: T): T
  get<T>(key: string, defaultValue?: T): T | undefined {
    const v = this.values.get(key)
    // biome-ignore plugin: ConfigStore.get is a typed accessor for a Map<string, unknown>;
    // the generic <T> is the caller's contract about what shape they stored. A type guard
    // is impossible here (T is erased at runtime), so the assertion is the only mechanism.
    return v !== undefined ? (v as T) : defaultValue
  }

  has(key: string): boolean {
    return this.values.has(key)
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value)
  }

  getAll(): Record<string, unknown> {
    return Object.fromEntries(this.values)
  }

  /**
   * Lookup the HTTPS proxy URL across the (legacy-shaped) keys we expect
   * upstream consumers to set. The envelope mirrors `PROXY_URL` onto
   * `process.env`, so an unconfigured-on-disk store can still resolve.
   * Returns the first non-empty match; undefined when no source has one.
   */
  getHttpsProxy(): string | undefined {
    const sources: Array<string | undefined> = [
      this.get<string>('HTTPS_PROXY'),
      this.get<string>('https_proxy'),
      this.get<string>('httpsProxy'),
      this.get<string>('PROXY_URL'),
      process.env.HTTPS_PROXY,
      process.env.https_proxy,
      process.env.PROXY_URL
    ]
    return sources.find((v): v is string => typeof v === 'string' && v.length > 0)
  }
}
