---
name: prisma-d1
description: Prisma ORM with Cloudflare D1 — schema configuration, migration workflow, client setup, and deployment. Load when working with Prisma + D1 migrations, schema changes, or PrismaClient instantiation in Workers.
metadata:
  author: Yuki Minakami
  version: "0.1.0"
  source: https://github.com/qtmleap/claude-plugins
---

# Prisma ORM + Cloudflare D1

Setup, migration, and deployment guide for Prisma with Cloudflare D1.

## Retrieval Source

| Source | URL | Use for |
|--------|-----|---------|
| Prisma D1 Guide | `https://www.prisma.io/docs/guides/deployment/cloudflare-d1` | Official guide |
| Prisma Migrate Diff | `https://www.prisma.io/docs/orm/reference/prisma-cli-reference#migrate-diff` | migrate diff options |
| D1 Docs | `https://developers.cloudflare.com/d1` | D1 specs and limitations |

## Required Packages

```bash
bun add prisma --dev
bun add @prisma/client @prisma/adapter-d1
```

## Schema Configuration (prisma/schema.prisma)

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
  runtime  = "cloudflare"
}

datasource db {
  provider = "sqlite"
}
```

**Key points:**
- `provider = "sqlite"` — D1 is SQLite-based
- `runtime = "cloudflare"` — generates client for Cloudflare Workers runtime
- `output` — must be explicitly specified

## Migration Workflow

D1 does **not** use standard `prisma migrate dev`. Instead, use `prisma migrate diff` to generate SQL, then `wrangler d1 execute` to apply it.

### Initial Migration

```bash
# Generate SQL (empty state -> current schema)
bunx prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script > migrations/0001_init.sql

# Apply to local D1
bunx wrangler d1 execute <DB_NAME> --local \
  --file="./migrations/0001_init.sql"

# Apply to remote D1
bunx wrangler d1 execute <DB_NAME> --remote \
  --file="./migrations/0001_init.sql"
```

### Subsequent Migrations

```bash
# Generate SQL (current local D1 state -> current schema)
bunx prisma migrate diff \
  --from-local-d1 \
  --to-schema prisma/schema.prisma \
  --script > migrations/0002_<description>.sql

# Apply locally
bunx wrangler d1 execute <DB_NAME> --local \
  --file="./migrations/0002_<description>.sql"

# Apply remotely
bunx wrangler d1 execute <DB_NAME> --remote \
  --file="./migrations/0002_<description>.sql"
```

### Migration Naming Convention

Place sequentially numbered SQL files in the `migrations/` directory:
- `0001_init.sql`
- `0002_add_exercises.sql`
- `0003_add_index.sql`

## Prisma Client Generation

```bash
bunx prisma generate
```

Must be run after every schema change. Generates typed client at the `output` path.

## Using PrismaClient in Workers

```typescript
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'

// Inside Workers fetch handler:
const adapter = new PrismaD1(env.DB)
const prisma = new PrismaClient({ adapter })

const users = await prisma.user.findMany()

// Resource cleanup (required)
ctx.waitUntil(prisma.$disconnect())
```

**Important:**
- `env.DB` must match the `binding` name in `wrangler.toml` / `wrangler.jsonc` `d1_databases`
- Always call `prisma.$disconnect()` — prevents memory leaks
- Use `ctx.waitUntil()` to disconnect asynchronously after response is sent

## wrangler.toml D1 Binding Configuration

```toml
[[d1_databases]]
binding = "DB"
database_name = "your-db-name"
database_id = "your-db-id"
```

## prisma.config.ts (for migrations)

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: env('DATABASE_URL')
  }
})
```

`.env`:
```
DATABASE_URL="file:./prisma/db.sqlite"
```

## Common Pitfalls

1. **`prisma migrate dev` does not work** — D1 requires `migrate diff` + `wrangler d1 execute` workflow
2. **Forgetting `prisma generate`** — client must be regenerated after schema changes
3. **Binding name mismatch** — `binding` in `wrangler.toml` must match `env.DB` in code
4. **Missing `$disconnect()`** — causes Workers memory exhaustion
5. **Local and remote are separate** — migrations must be applied independently with `--local` and `--remote`
6. **SQLite limitations** — D1 is SQLite-based, so some Prisma features like `@db.Text` and `Json` type are unavailable
7. **No interactive transactions** — D1 does not support Prisma's interactive `$transaction(async (tx) => …)`; it always fails at runtime. Use a batch `$transaction([...])` of array-form operations, or restructure the code to avoid a transaction