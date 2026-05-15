import type { FastifyReply, FastifyRequest } from 'fastify'

// Paths reachable while running in "setup-only" mode (APIKEY not yet
// configured). Everything else returns 503 so the service cannot be used
// as an open proxy until the operator finishes the setup flow.
const SETUP_ALLOWED_EXACT = new Set<string>(['/', '/health', '/api/config', '/api/restart'])

const SETUP_ALLOWED_PREFIXES = ['/ui']

const isSetupAllowed = (url: string): boolean => {
  const path = url.split('?')[0]
  if (SETUP_ALLOWED_EXACT.has(path)) return true
  return SETUP_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
}

export const apiKeyAuth = (config: any) => async (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
  // Public endpoints that don't require authentication
  const publicPaths = ['/', '/health']
  if (publicPaths.includes(req.url) || req.url.startsWith('/ui')) {
    return done()
  }

  // Check if Providers is empty or not configured
  const providers = config.Providers || config.providers || []
  if (!providers || providers.length === 0) {
    // No providers configured, skip authentication
    return done()
  }

  const apiKey = config.APIKEY
  if (!apiKey) {
    // Setup-only mode: allow the UI to read/write config and trigger a
    // restart, but block every other API surface to avoid exposing an
    // unauthenticated proxy on a public HOST (e.g. via Cloudflared).
    if (!isSetupAllowed(req.url)) {
      reply.status(503).send({
        error: 'APIKEY not configured',
        message: 'Service is in setup-only mode. Open the web UI to configure an APIKEY, then restart.'
      })
      return
    }
    return done()
  }

  const authHeaderValue = req.headers.authorization || req.headers['x-api-key']
  const authKey: string = Array.isArray(authHeaderValue) ? authHeaderValue[0] : authHeaderValue || ''
  if (!authKey) {
    reply.status(401).send('APIKEY is missing')
    return
  }
  const token = authKey.startsWith('Bearer') ? authKey.split(' ')[1] : authKey

  if (token !== apiKey) {
    reply.status(401).send('Invalid API key')
    return
  }

  done()
}
