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
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Start the postgres service from .devcontainer/compose.yaml and copy .env.example to .env.'
  )
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL
  },
  migrations: {
    adapter: async () => new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  }
})
