/**
 * Prisma 7 moved the connection URL out of schema.prisma. The CLI reads
 * this file to know how to talk to Postgres for `migrate dev`, `migrate
 * deploy`, `studio`, etc. The runtime client builds its own adapter in
 * src/db/client.ts — keep the two in sync.
 */

import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    adapter: async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          'DATABASE_URL is not set. Start the postgres service from .devcontainer/compose.yaml and copy .env.example to .env.'
        )
      }
      return new PrismaPg({ connectionString: process.env.DATABASE_URL })
    }
  }
})
