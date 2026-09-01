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
 *   bun run scripts/rename-dev-database.ts --verify   # after editing env
 */

import { createHash } from 'node:crypto'
import 'dotenv/config'
import dotenv from 'dotenv'
import { Client } from 'pg'
import { decryptString, encryptionKey } from '../src/services/subscription-account-sync/crypto'

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['ccr', 'rialto'],
  ['ccr_test', 'rialto_test'],
]

const dryRun = process.argv.includes('--dry-run')
const verifyOnly = process.argv.includes('--verify')

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

/**
 * Report the state after the rename, including the parts this script
 * cannot change itself. Prints no secret values: the key is a short
 * SHA-256 fingerprint, and the real proof is whether an existing
 * SubAccount row still decrypts under it.
 */
async function verify(): Promise<void> {
  const fp = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 12)
  const isSet = (v: string | undefined): v is string => typeof v === 'string' && v.length > 0

  // The shell's exported values are what the server actually gets:
  // dotenv does not override an already-exported variable. Parsing the
  // file separately (into a throwaway object, never process.env) is the
  // only way to tell "not edited yet" from "edited, but this shell still
  // holds the old export".
  const fileVars: Record<string, string> = {}
  dotenv.config({ processEnv: fileVars, override: true })
  const fileHas = Object.keys(fileVars).length > 0

  const oldKey = process.env.CCR_ACCOUNT_ENCRYPTION_KEY
  const newKey = process.env.RIALTO_ACCOUNT_ENCRYPTION_KEY

  console.log('--- environment ---')
  console.log(
    'RIALTO_ACCOUNT_ENCRYPTION_KEY :',
    isSet(newKey) ? `set        fp=${fp(newKey)}` : 'UNSET      <- must be set'
  )
  console.log(
    'CCR_ACCOUNT_ENCRYPTION_KEY    :',
    isSet(oldKey) ? `still set  fp=${fp(oldKey)}  <- no longer read; delete once the check below passes` : 'unset'
  )
  if (isSet(oldKey) && isSet(newKey) && oldKey !== newKey) {
    console.log('  !! the two differ - the new name must carry the OLD value byte-for-byte')
  }

  const dbName = (v: string | undefined): string => (isSet(v) ? new URL(v).pathname.replace('/', '') : '(unset)')
  const dev = dbName(process.env.DATABASE_URL)
  const test = dbName(process.env.TEST_DATABASE_URL)
  console.log(`DATABASE_URL                  : ${dev} ${dev === 'rialto' ? 'OK' : '<- expected rialto'}`)
  console.log(`TEST_DATABASE_URL             : ${test} ${test === 'rialto_test' ? 'OK' : '<- expected rialto_test'}`)

  // Where the two disagree, the shell wins and the edit looks ineffective.
  if (fileHas) {
    const drift: string[] = []
    const cmp = (name: string, shellVal: string | undefined, render: (v: string | undefined) => string): void => {
      const inFile = fileVars[name]
      if (typeof inFile === 'string' && render(inFile) !== render(shellVal)) {
        drift.push(`  ${name}: file says ${render(inFile)}, this shell has ${render(shellVal)}`)
      }
    }
    cmp('DATABASE_URL', process.env.DATABASE_URL, dbName)
    cmp('TEST_DATABASE_URL', process.env.TEST_DATABASE_URL, dbName)
    cmp('RIALTO_ACCOUNT_ENCRYPTION_KEY', newKey, (v) => (isSet(v) ? `set fp=${fp(v)}` : 'unset'))
    if (drift.length > 0) {
      console.log('\n--- the file and this shell disagree ---')
      for (const line of drift) console.log(line)
      console.log('  The exported value wins: dotenv does not override it, so the server')
      console.log('  sees what this shell has. Open a new terminal (or `direnv reload`).')
    } else {
      // Stated positively so "nothing printed" is never mistaken for
      // "the edit landed but the shell is stale".
      console.log(`\n  The env file (${Object.keys(fileVars).length} vars) matches this shell, so what is`)
      console.log('  shown above is what the file itself says.')
    }
  } else {
    console.log('\n  (no local env file parsed - these came from the shell or the container)')
  }

  console.log('\n--- do existing accounts still decrypt? ---')
  try {
    const key = encryptionKey()
    const c = new Client({ connectionString: process.env.DATABASE_URL })
    await c.connect()
    try {
        const r = await c.query<{ label: string; accessTokenEnc: string | null; refreshTokenEnc: string | null }>(
        'select label, "accessTokenEnc", "refreshTokenEnc" from "SubAccount" order by label'
      )
      if (r.rows.length === 0) console.log('  (no SubAccount rows)')
      for (const row of r.rows) {
        const a = decryptString(row.accessTokenEnc, key)
        const rt = decryptString(row.refreshTokenEnc, key)
        // A stored-but-undecryptable value is the failure this whole
        // check exists to catch, so null-out only counts as fine when
        // there was nothing stored in the first place.
        const ok = (row.accessTokenEnc === null || a !== null) && (row.refreshTokenEnc === null || rt !== null)
        const desc = (v: string | null): string => (v === null ? 'none' : `${v.length} chars`)
        console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${row.label}   access=${desc(a)}  refresh=${desc(rt)}`)
      }
    } finally {
      await c.end()
    }
  } catch (err) {
    console.log('  FAILED:', err instanceof Error ? err.message : String(err))
  }
}

if (verifyOnly) {
  await verify()
  process.exit(0)
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
