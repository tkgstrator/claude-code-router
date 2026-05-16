import pkg from '../../package.json'

// Single source of truth for the app version surfaced by the API
// (update-check comparison + the OpenAPI doc). Was @ccr/server/package
// before the Prisma/server merge into src/.
export const APP_VERSION: string = pkg.version
