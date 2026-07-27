import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { logger } from '../logger'
import { syncSubAccountProfiles } from './subscription-account-sync-service'

const QUEUE = 'auth-health'
const SCHEDULER_ID = 'auth-health-check'
const JOB_NAME = 'check'
// Every 15 minutes. The probe refreshes Claude tokens and pings each
// account's profile / usage endpoint, so it is heavier than the usage
// poll — 15 min keeps re-auth detection timely without hammering the
// upstreams. syncSubAccountProfiles persists the per-account authStatus.
const CRON = '*/15 * * * *'

// Survive Vite SSR module re-evaluation / HMR: one job setup per
// process. The repeatable schedule itself is Redis-owned (idempotent
// via upsertJobScheduler by id), so even a duplicate start can't
// double-fire — this just avoids leaking extra Worker/connection
// instances.
declare global {
  var __ccrAuthHealthJobStarted: boolean | undefined
}

let warnedOnce = false
const onRedisError = (err: unknown): void => {
  if (warnedOnce) return
  warnedOnce = true
  logger.warn({ err }, '[auth-health-job] Redis unavailable — auth health will not refresh until it is reachable')
}

// BullMQ requires maxRetriesPerRequest: null on the connection it uses
// for blocking commands (the Worker).
const makeConnection = (url: string): IORedis =>
  new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false }).on('error', onRedisError)

// Set up the recurring auth-health job: a Redis-backed repeatable
// scheduler (every 15 min) plus an in-process Worker that re-probes each
// subscription account and records its authStatus. Never throws — if
// Redis is down the server still serves; the schedule registers once
// Redis is reachable again.
export async function startAuthHealthCheck(): Promise<void> {
  if (globalThis.__ccrAuthHealthJobStarted) return
  const url = process.env.REDIS_URL
  if (!url || url.length === 0) {
    logger.warn('[auth-health-job] REDIS_URL is not set — skipping the auth-health job')
    return
  }
  globalThis.__ccrAuthHealthJobStarted = true

  const queueConn = makeConnection(url)
  const queue = new Queue(QUEUE, { connection: queueConn })
  new Worker(
    QUEUE,
    async () => {
      await syncSubAccountProfiles()
    },
    { connection: makeConnection(url) }
  ).on('error', onRedisError)

  const register = async (): Promise<void> => {
    try {
      await queue.upsertJobScheduler(SCHEDULER_ID, { pattern: CRON }, { name: JOB_NAME })
    } catch (err) {
      onRedisError(err)
    }
  }
  // Register now, and again on every (re)connect so the schedule
  // isn't lost if Redis was down at boot. upsertJobScheduler is
  // idempotent by id, so re-running it is safe.
  await register()
  queueConn.on('ready', () => {
    void register()
  })
}
