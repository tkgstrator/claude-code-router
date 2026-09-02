/**
 * The two totals the Activity tab strip prints.
 *
 * Both list endpoints return their `total` alongside the page, so a
 * one-row request is enough to read the count. Screens that already fetch
 * a full page take the totals from that instead of calling this.
 */
import { useEffect, useState } from 'react'
import { fetchRequestLogs } from '@/components/rialto/activity/data'
import { api } from '@/lib/api'

// Sessions are counted over the same window the Sessions tab defaults to,
// so the number under the tab matches the table it leads to.
const COUNT_WINDOW_HOURS = 168

export interface ActivityCounts {
  sessions?: number
  requests?: number
}

export function useActivityCounts(): ActivityCounts {
  const [counts, setCounts] = useState<ActivityCounts>({})

  useEffect(() => {
    void Promise.all([api.getRequestLogSessions({ limit: 1, sinceHours: COUNT_WINDOW_HOURS }), fetchRequestLogs(1)])
      .then(([sessions, logs]) => setCounts({ sessions: sessions.total, requests: logs.total }))
      .catch(() => {
        // Tab ornament only: no count is better than a wrong one.
      })
  }, [])

  return counts
}
