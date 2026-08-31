import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { logger } from '../logger'
import { pruneOldSnapshots, recordUsageSnapshots } from './usage-history-service'

const QUEUE = 'usage'
const SCHEDULER_ID = 'usage-capture'
const JOB_NAME = 'capture'
// Fire on the wall-clock 5-minute marks (:00/:05/:10 …) rather than
// `every: 300000`, which drifts by whatever offset the scheduler was
// first registered at. The capture timestamp is rounded to the same
// grid in usageHistoryService, so this just keeps fire ≈ stored time.
const CRON = '*/5 * * * *'

// Survive Vite SSR module re-evaluation / HMR: one job setup per
// process. The repeatable schedule itself is Redis-owned (idempotent
// via upsertJobScheduler by id), so even a duplicate start can't
// double-fire — this just avoids leaking extra Worker/connection
// instances.
declare global {
  var __rialtoUsageJobStarted: boolean | undefined
}

let warnedOnce = false
const onRedisError = (err: unknown): void => {
  if (warnedOnce) return
  warnedOnce = true
  logger.warn({ err }, '[usage-job] Redis unavailable — usage history will not update until it is reachable')
}

// BullMQ requires maxRetriesPerRequest: null on the connection it uses
// for blocking commands (the Worker).
const makeConnection = (url: string): IORedis =>
  new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false }).on('error', onRedisError)

// Set up the recurring usage-capture job: a Redis-backed repeatable
// scheduler (every 5 min) plus an in-process Worker that runs the
// capture + prune. Never throws — if Redis is down the server still
// serves; the schedule registers once Redis is reachable again.
export async function startUsageCapture(): Promise<void> {
  if (globalThis.__rialtoUsageJobStarted) return
  const url = process.env.REDIS_URL
  if (!url || url.length === 0) {
    logger.warn('[usage-job] REDIS_URL is not set — skipping the usage-capture job')
    return
  }
  globalThis.__rialtoUsageJobStarted = true

  const queueConn = makeConnection(url)
  const queue = new Queue(QUEUE, { connection: queueConn })
  new Worker(
    QUEUE,
    async () => {
      await recordUsageSnapshots()
      await pruneOldSnapshots()
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
