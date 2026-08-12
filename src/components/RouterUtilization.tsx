/**
 * Router utilization dashboard (Phase 7).
 *
 * Three read-only panels:
 *   - Per-scenario request counts (total / ok / 429 / other error)
 *   - Per-target flow (requested → sent-to)
 *   - Per-account remaining budget (subscription accounts only)
 *
 * Plus a "Suggestions" section that renders detector output as
 * dismissable cards. Suggestions carry a JSON diff — the button
 * "Show diff" opens the proposedDiff verbatim; applying it is a
 * future step (Phase 6's editor is the sole write path today).
 */

import { RefreshCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api, type RouterUtilizationResponse } from '@/lib/api'
import type { ShellOutletContext } from './AppShell'

const WINDOW_OPTIONS: readonly number[] = [1, 6, 24, 72, 168]

export function RouterUtilization() {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [windowHours, setWindowHours] = useState<number>(24)
  const [data, setData] = useState<RouterUtilizationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [openDiff, setOpenDiff] = useState<string | null>(null)

  const refresh = useCallback(
    async (hours: number) => {
      setLoading(true)
      try {
        const out = await api.getRouterUtilization({ windowHours: hours })
        setData(out)
      } catch (err) {
        showToast(`${t('routerUtilization.loadFailed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        setLoading(false)
      }
    },
    [showToast, t]
  )

  useEffect(() => {
    void refresh(windowHours)
  }, [refresh, windowHours])

  return (
    <PageContainer>
      <PageHeader title={t('routerUtilization.title')} />
      <PageContent className='space-y-6'>
        <p className='text-muted-foreground text-sm'>{t('routerUtilization.description')}</p>

        <div className='flex items-center gap-2'>
          <span className='text-sm text-muted-foreground'>{t('routerUtilization.window')}:</span>
          {WINDOW_OPTIONS.map((h) => (
            <Button
              key={h}
              size='sm'
              variant={windowHours === h ? 'default' : 'ghost'}
              onClick={() => setWindowHours(h)}
            >
              {h}h
            </Button>
          ))}
          <Button size='sm' variant='ghost' onClick={() => void refresh(windowHours)} disabled={loading}>
            <RefreshCcw className='h-4 w-4' />
          </Button>
        </div>

        {data === null && loading && <div className='text-muted-foreground text-sm'>{t('app.loading')}</div>}

        {data !== null && data.suggestions.length > 0 && (
          <section className='space-y-2'>
            <h2 className='font-medium text-sm'>{t('routerUtilization.suggestions')}</h2>
            <div className='divide-y border-y'>
              {data.suggestions.map((s) => (
                <div
                  key={`${s.kind}-${s.target}`}
                  className='border-l-2 border-l-amber-500 px-3 py-2 hover:bg-muted/50 transition-colors'
                >
                  <div className='flex items-center justify-between gap-3'>
                    <div className='flex-1'>
                      <div className='font-medium text-sm'>{s.target}</div>
                      <div className='text-xs text-muted-foreground'>{s.detail}</div>
                    </div>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setOpenDiff(openDiff === s.target ? null : s.target)}
                    >
                      {openDiff === s.target ? t('routerUtilization.hideDiff') : t('routerUtilization.showDiff')}
                    </Button>
                  </div>
                  {openDiff === s.target && (
                    <pre className='mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs'>
                      {JSON.stringify(s.proposedDiff, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {data !== null && (
          <section className='space-y-2'>
            <h2 className='font-medium text-sm'>{t('routerUtilization.perScenario')}</h2>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead className='border-b text-left text-muted-foreground text-xs'>
                  <tr>
                    <th className='py-2 pr-4'>{t('routerUtilization.scenario')}</th>
                    <th className='py-2 pr-4 text-right'>total</th>
                    <th className='py-2 pr-4 text-right'>ok</th>
                    <th className='py-2 pr-4 text-right'>429</th>
                    <th className='py-2 pr-4 text-right'>other</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {data.perScenario.map((r) => (
                    <tr key={r.scenario}>
                      <td className='py-2 pr-4'>{r.scenario}</td>
                      <td className='py-2 pr-4 text-right tabular-nums'>{r.total}</td>
                      <td className='py-2 pr-4 text-right tabular-nums'>{r.ok}</td>
                      <td className='py-2 pr-4 text-right tabular-nums'>{r.err429}</td>
                      <td className='py-2 pr-4 text-right tabular-nums'>{r.errOther}</td>
                    </tr>
                  ))}
                  {data.perScenario.length === 0 && (
                    <tr>
                      <td className='py-2 text-muted-foreground' colSpan={5}>
                        {t('routerUtilization.noTraffic')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data !== null && (
          <section className='space-y-2'>
            <h2 className='font-medium text-sm'>{t('routerUtilization.perTarget')}</h2>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead className='border-b text-left text-muted-foreground text-xs'>
                  <tr>
                    <th className='py-2 pr-4'>{t('routerUtilization.requested')}</th>
                    <th className='py-2 pr-4'>{t('routerUtilization.sentTo')}</th>
                    <th className='py-2 pr-4 text-right'>count</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {data.perTarget.slice(0, 100).map((r, i) => (
                    <tr key={`${r.requestedModel ?? '_'}-${r.sentTo}-${i}`}>
                      <td className='py-2 pr-4'>{r.requestedModel ?? '—'}</td>
                      <td className='py-2 pr-4'>{r.sentTo}</td>
                      <td className='py-2 pr-4 text-right tabular-nums'>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data !== null && (
          <section className='space-y-2'>
            <h2 className='font-medium text-sm'>{t('routerUtilization.perAccount')}</h2>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead className='border-b text-left text-muted-foreground text-xs'>
                  <tr>
                    <th className='py-2 pr-4'>{t('routerUtilization.account')}</th>
                    <th className='py-2 pr-4'>{t('routerUtilization.provider')}</th>
                    <th className='py-2 pr-4'>kind</th>
                    <th className='py-2 pr-4 text-right'>{t('routerUtilization.budget')}</th>
                    <th className='py-2 pr-4'>5h reset</th>
                    <th className='py-2 pr-4'>weekly reset</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {data.perAccount.map((a) => (
                    <tr key={a.subAccountId} className={a.stale ? 'text-muted-foreground' : ''}>
                      <td className='py-2 pr-4 font-mono text-xs'>{a.subAccountId.slice(0, 8)}</td>
                      <td className='py-2 pr-4'>{a.providerName}</td>
                      <td className='py-2 pr-4'>{a.kind}</td>
                      <td className='py-2 pr-4 text-right tabular-nums'>
                        {a.currentBudgetPct === null ? '—' : `${a.currentBudgetPct}%`}
                      </td>
                      <td className='py-2 pr-4 text-xs'>{a.fiveHourResetAt ?? '—'}</td>
                      <td className='py-2 pr-4 text-xs'>{a.weeklyResetAt ?? '—'}</td>
                    </tr>
                  ))}
                  {data.perAccount.length === 0 && (
                    <tr>
                      <td className='py-2 text-muted-foreground' colSpan={6}>
                        {t('routerUtilization.noAccounts')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </PageContent>
    </PageContainer>
  )
}
