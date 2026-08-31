/**
 * One-shot local rename: ccr -> rialto, ccr_test -> rialto_test.
 *
 * Only for postgres volumes created before the Rialto rename. A fresh
 * volume is already provisioned with the new names by the devcontainer's
 * initdb script, and this then reports nothing to do.
 *
 * `ALTER DATABASE ... RENAME TO` keeps everything inside the database,
 * `_prisma_migrations` included, so migration history is untouched and no
 * `prisma migrate` run is needed afterwards. It cannot run inside a
 * transaction and is refused while any backend is connected, hence the
 * terminate below — stop the dev server first if you would rather not
 * have its pool cut.
 *
 * Afterwards DATABASE_URL and TEST_DATABASE_URL must point at the new
 * names; this script prints what to change and cannot do it itself.
 *
 *   bun run scripts/rename-dev-database.ts          # rename
 *   bun run scripts/rename-dev-database.ts --dry-run
 */

import 'dotenv/config'
import { Client } from 'pg'

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['ccr', 'rialto'],
  ['ccr_test', 'rialto_test'],
]

const dryRun = process.argv.includes('--dry-run')

const base = process.env.DATABASE_URL
if (typeof base !== 'string' || base.length === 0) {
  console.error('DATABASE_URL is not set; nothing to connect to.')
  process.exit(1)
}

const urlFor = (db: string): string => {
  const u = new URL(base)
  u.pathname = `/${db}`
  return u.toString()
}

/** Public-schema table count, used to prove the rename moved the data. */
async function tableCount(db: string): Promise<number> {
  const probe = new Client({ connectionString: urlFor(db) })
  await probe.connect()
  try {
    const r = await probe.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'"
    )
    return r.rows[0].n
  } finally {
    await probe.end()
  }
}

const admin = new Client({ connectionString: urlFor('postgres') })
await admin.connect()

const has = async (name: string): Promise<boolean> => {
  const r = await admin.query('select 1 from pg_database where datname = $1', [name])
  return r.rowCount === 1
}

const renamed: string[] = []

for (const [from, to] of PAIRS) {
  if (!(await has(from))) {
    console.log(`- ${from}: not present, skipping`)
    continue
  }
  if (await has(to)) {
    // Both names existing means someone created the new one separately.
    // Renaming over it is impossible and dropping it is not this
    // script's call, so stop and let a human decide.
    console.log(`! ${from} and ${to} both exist - leaving both alone; resolve by hand`)
    continue
  }
  const before = await tableCount(from)
  if (dryRun) {
    console.log(`  would rename ${from} -> ${to} (${before} public tables)`)
    continue
  }
  await admin.query(
    'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
    [from]
  )
  await admin.query(`alter database "${from}" rename to "${to}"`)
  const after = await tableCount(to)
  const ok = before === after
  console.log(`${ok ? 'OK' : 'FAIL'} ${from} -> ${to}   public tables ${before} -> ${after}${ok ? '' : '  MISMATCH'}`)
  if (ok) renamed.push(to)
}

await admin.end()

if (renamed.length > 0) {
  console.log('\nNow update the environment file - the rest of the value is unchanged:')
  console.log('  DATABASE_URL      .../ccr       ->  .../rialto')
  console.log('  TEST_DATABASE_URL .../ccr_test  ->  .../rialto_test')
}
