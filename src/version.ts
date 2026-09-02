import pkg from '../package.json'

// Single source of truth for the app version surfaced by the API
// (update-check comparison + the OpenAPI doc). Came from the server
// package's own package.json before the Prisma/server merge into src/.
export const APP_VERSION: string = pkg.version
