/**
 * Prisma 7 moved the connection URL out of schema.prisma. The CLI reads
 * this file to know how to talk to Postgres for `migrate dev`, `migrate
 * deploy`, `studio`, etc. The runtime client builds its own adapter in
 * src/db/client.ts — keep the two in sync.
 */

import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'

// The .env lives at the repo root; load it explicitly so CLI invocations
// from packages/server (where Prisma's cwd ends up) still see DATABASE_URL.
// `prisma generate` doesn't need the URL so we don't fail at top level —
// the throw happens inside the adapter factory, which only runs for
// commands that actually talk to the DB (migrate, studio, etc.).
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const requireDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Start the postgres service from .devcontainer/compose.yaml and copy .env.example to .env.'
    )
  }
  return url
}

// `datasource` is intentionally omitted — `prisma generate` reads the
// URL from schema.prisma's `datasource db` block, and the adapter below
// handles the real connection for migrate / studio. That keeps
// postinstall side of generate working even when DATABASE_URL is
// absent (CI before the .env is laid down, etc.).
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    adapter: async () => new PrismaPg({ connectionString: requireDatabaseUrl() })
  }
})
