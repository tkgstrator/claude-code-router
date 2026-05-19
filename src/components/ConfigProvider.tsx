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

// Coerce the raw /api/config wire shape (which now carries explicit
// nulls for unset api_key / path scalars / router slots) into the typed
// Config the app's controlled inputs expect (non-null strings, arrays).
// Centralized so both the mount fetch and reloadConfig stay in sync.
function normalizeConfig(data: Config): Config {
  return {
    LOG: typeof data.LOG === 'boolean' ? data.LOG : false,
    LOG_LEVEL: typeof data.LOG_LEVEL === 'string' ? data.LOG_LEVEL : 'debug',
    CLAUDE_PATH: typeof data.CLAUDE_PATH === 'string' ? data.CLAUDE_PATH : '',
    HOST: typeof data.HOST === 'string' ? data.HOST : '127.0.0.1',
    PORT: typeof data.PORT === 'number' ? data.PORT : 3456,
    APIKEY: typeof data.APIKEY === 'string' ? data.APIKEY : '',
    API_TIMEOUT_MS: typeof data.API_TIMEOUT_MS === 'string' ? data.API_TIMEOUT_MS : '600000',
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
    Router:
      data.Router && typeof data.Router === 'object'
        ? {
            default: typeof data.Router.default === 'string' ? data.Router.default : null,
            background: typeof data.Router.background === 'string' ? data.Router.background : null,
            think: typeof data.Router.think === 'string' ? data.Router.think : null,
            longContext: typeof data.Router.longContext === 'string' ? data.Router.longContext : null,
            longContextThreshold:
              typeof data.Router.longContextThreshold === 'number' ? data.Router.longContextThreshold : 60000,
            webSearch: typeof data.Router.webSearch === 'string' ? data.Router.webSearch : null,
            image: typeof data.Router.image === 'string' ? data.Router.image : null
          }
        : {
            default: null,
            background: null,
            think: null,
            longContext: null,
            longContextThreshold: 60000,
            webSearch: null,
            image: null
          },
    CUSTOM_ROUTER_PATH: typeof data.CUSTOM_ROUTER_PATH === 'string' ? data.CUSTOM_ROUTER_PATH : ''
  }
}

const emptyConfig = (): Config => ({
  LOG: false,
  LOG_LEVEL: 'debug',
  CLAUDE_PATH: '',
  HOST: '127.0.0.1',
  PORT: 3456,
  APIKEY: '',
  API_TIMEOUT_MS: '600000',
  PROXY_URL: '',
  transformers: [],
  Providers: [],
  StatusLine: undefined,
  Router: {
    default: '',
    background: '',
    think: '',
    longContext: '',
    longContextThreshold: 60000,
    webSearch: '',
    image: ''
  },
  CUSTOM_ROUTER_PATH: ''
})

export function ConfigProvider({ children }: ConfigProviderProps) {
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [hasFetched, setHasFetched] = useState<boolean>(false)
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
    }

    fetchConfig()
  }, [apiKey])

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

  return <ConfigContext.Provider value={{ config, setConfig, reloadConfig, error }}>{children}</ConfigContext.Provider>
}
