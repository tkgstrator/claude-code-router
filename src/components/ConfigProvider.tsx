import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Config } from '@/types'

interface ConfigContextType {
  config: Config | null
  setConfig: Dispatch<SetStateAction<Config | null>>
  // Re-fetch /api/config and re-apply the same normalization the
  // provider does on mount (raw nulls -> '' / [] for the typed Config
  // the rest of the app consumes). Used by the JSON editor after a save
  // so other screens see a fresh, normalized config rather than the raw
  // (possibly-null) payload the editor itself displays.
  reloadConfig: () => Promise<void>
  error: Error | null
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined)

// eslint-disable-next-line react-refresh/only-export-components
export function useConfig() {
  const context = useContext(ConfigContext)
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider')
  }
  return context
}

interface ConfigProviderProps {
  children: ReactNode
}

// Coerce the per-scenario fallback chains off the raw wire shape into
// the full { scenario: string[] } object the form expects. A missing /
// malformed list normalizes to an empty array.
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Coerce one scenario's raw route into the nested { primary, fallbacks,
// force } shape the form binds to. Defensive against a partial / stale
// wire object (missing keys default to unset).
function normalizeRoute(raw: unknown): { primary: string | null; fallbacks: string[]; force: boolean } {
  const obj = raw !== null && typeof raw === 'object' ? raw : {}
  const primary = Reflect.get(obj, 'primary')
  return {
    primary: typeof primary === 'string' && primary !== '' ? primary : null,
    fallbacks: asStringArray(Reflect.get(obj, 'fallbacks')),
    force: Reflect.get(obj, 'force') === true
  }
}

function numberOr(raw: unknown, fallback: number): number {
  return typeof raw === 'number' ? raw : fallback
}

// Build the nested Config['Router'] from the raw wire object. Each
// scenario nests its own primary + fallback chain + force; the two
// scenario-scoped knobs (threshold on longContext, weeklyDrainMarginPct
// on default) ride on their owning scenario.
function normalizeRouter(raw: unknown): Config['Router'] {
  const obj = raw !== null && typeof raw === 'object' ? raw : {}
  const get = (k: string): unknown => Reflect.get(obj, k)
  const defaultRaw = get('default')
  const longContextRaw = get('longContext')
  const defObj = defaultRaw !== null && typeof defaultRaw === 'object' ? defaultRaw : {}
  const lcObj = longContextRaw !== null && typeof longContextRaw === 'object' ? longContextRaw : {}
  const persona = get('persona')
  return {
    default: {
      ...normalizeRoute(defaultRaw),
      weeklyDrainMarginPct: numberOr(Reflect.get(defObj, 'weeklyDrainMarginPct'), 0)
    },
    background: normalizeRoute(get('background')),
    think: normalizeRoute(get('think')),
    longContext: { ...normalizeRoute(longContextRaw), threshold: numberOr(Reflect.get(lcObj, 'threshold'), 60000) },
    webSearch: normalizeRoute(get('webSearch')),
    image: normalizeRoute(get('image')),
    persona: typeof persona === 'string' && persona !== '' ? persona : undefined
  }
}

// Coerce the raw /api/config wire shape (which now carries explicit
// nulls for unset api_key / path scalars / router slots) into the typed
// Config the app's controlled inputs expect (non-null strings, arrays).
// Centralized so both the mount fetch and reloadConfig stay in sync.
function normalizeConfig(data: Config): Config {
  return {
    LOG: typeof data.LOG === 'boolean' ? data.LOG : false,
    LOG_LEVEL: typeof data.LOG_LEVEL === 'string' && data.LOG_LEVEL !== '' ? data.LOG_LEVEL : 'info',
    CLAUDE_PATH: typeof data.CLAUDE_PATH === 'string' ? data.CLAUDE_PATH : '',
    HOST: typeof data.HOST === 'string' ? data.HOST : '127.0.0.1',
    PORT: typeof data.PORT === 'number' ? data.PORT : 3456,
    APIKEY: typeof data.APIKEY === 'string' ? data.APIKEY : '',
    API_TIMEOUT_MS: typeof data.API_TIMEOUT_MS === 'number' ? data.API_TIMEOUT_MS : 600000,
    PROXY_URL: typeof data.PROXY_URL === 'string' ? data.PROXY_URL : '',
    transformers: Array.isArray(data.transformers) ? data.transformers : [],
    Providers: Array.isArray(data.Providers) ? data.Providers : [],
    StatusLine:
      data.StatusLine && typeof data.StatusLine === 'object'
        ? {
            enabled: typeof data.StatusLine.enabled === 'boolean' ? data.StatusLine.enabled : false,
            currentStyle: typeof data.StatusLine.currentStyle === 'string' ? data.StatusLine.currentStyle : 'default',
            default:
              data.StatusLine.default &&
              typeof data.StatusLine.default === 'object' &&
              Array.isArray(data.StatusLine.default.modules)
                ? data.StatusLine.default
                : { modules: [] },
            powerline:
              data.StatusLine.powerline &&
              typeof data.StatusLine.powerline === 'object' &&
              Array.isArray(data.StatusLine.powerline.modules)
                ? data.StatusLine.powerline
                : { modules: [] }
          }
        : {
            enabled: false,
            currentStyle: 'default',
            default: { modules: [] },
            powerline: { modules: [] }
          },
    Router: normalizeRouter(data.Router),
    CUSTOM_ROUTER_PATH: typeof data.CUSTOM_ROUTER_PATH === 'string' ? data.CUSTOM_ROUTER_PATH : '',
    // Guarantee every persona carries a stable uuid `id` (the key the URL
    // and Router.persona reference). The server's boot migration backfills
    // ids on disk; this is the defensive UI mirror for any persona that
    // still arrives without one.
    Personas: Array.isArray(data.Personas)
      ? data.Personas.map((persona) => ({
          id: typeof persona.id === 'string' && persona.id !== '' ? persona.id : crypto.randomUUID(),
          name: persona.name,
          prompt: persona.prompt
        }))
      : []
  }
}

const emptyConfig = (): Config => ({
  LOG: false,
  LOG_LEVEL: 'info',
  CLAUDE_PATH: '',
  HOST: '127.0.0.1',
  PORT: 3456,
  APIKEY: '',
  API_TIMEOUT_MS: 600000,
  PROXY_URL: '',
  transformers: [],
  Providers: [],
  StatusLine: undefined,
  Router: {
    default: { primary: null, fallbacks: [], force: false, weeklyDrainMarginPct: 0 },
    background: { primary: null, fallbacks: [], force: false },
    think: { primary: null, fallbacks: [], force: false },
    longContext: { primary: null, fallbacks: [], force: false, threshold: 60000 },
    webSearch: { primary: null, fallbacks: [], force: false },
    image: { primary: null, fallbacks: [], force: false },
    persona: undefined
  },
  CUSTOM_ROUTER_PATH: '',
  Personas: []
})

export function ConfigProvider({ children }: ConfigProviderProps) {
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [hasFetched, setHasFetched] = useState<boolean>(false)
  const [authFailed, setAuthFailed] = useState<boolean>(false)
  const [apiKey, setApiKey] = useState<string | null>(localStorage.getItem('apiKey'))

  // Listen for localStorage changes
  useEffect(() => {
    const handleStorageChange = () => {
      setApiKey(localStorage.getItem('apiKey'))
    }

    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  useEffect(() => {
    const fetchConfig = async () => {
      // Reset fetch state when API key changes
      setHasFetched(false)
      setConfig(null)
      setError(null)
      setAuthFailed(false)
    }

    fetchConfig()
  }, [apiKey])

  // api.ts strips the stored key and emits this on an auth failure.
  // The 401 path never resolves the fetch (config stays null), so this
  // is what releases the loading gate below and lets the router show
  // the login screen.
  useEffect(() => {
    const onUnauthorized = () => setAuthFailed(true)
    window.addEventListener('unauthorized', onUnauthorized)
    return () => window.removeEventListener('unauthorized', onUnauthorized)
  }, [])

  const reloadConfig = useCallback(async () => {
    try {
      const data = await api.getConfig()
      setConfig(normalizeConfig(data))
      setError(null)
    } catch (err) {
      console.error('Failed to fetch config:', err)
      // If we get a 401, the API client will redirect to login
      // Otherwise, set an empty config or error
      if ((err as Error).message !== 'Unauthorized') {
        setConfig(emptyConfig())
        setError(err as Error)
      }
    }
  }, [])

  useEffect(() => {
    const fetchConfig = async () => {
      // Prevent duplicate API calls in React StrictMode
      // Skip if we've already fetched
      if (hasFetched) {
        return
      }
      setHasFetched(true)
      await reloadConfig()
    }

    fetchConfig()
  }, [hasFetched, apiKey, reloadConfig])

  // Hold the whole app on a single loading screen until the first
  // config fetch settles, so no page ever renders against a null or
  // half-loaded config. On auth failure authFailed flips (above) so
  // the router can still reach /login.
  if (config === null && error === null && !authFailed) {
    return (
      <div className='h-screen bg-background font-sans flex items-center justify-center'>
        <div className='text-muted-foreground'>Loading configuration...</div>
      </div>
    )
  }

  return <ConfigContext.Provider value={{ config, setConfig, reloadConfig, error }}>{children}</ConfigContext.Provider>
}
