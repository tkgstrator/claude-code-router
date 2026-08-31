/**
 * State machine behind the add-provider flow.
 *
 * The OAuth half finishes in a DIFFERENT browser tab — the vendor
 * redirects there, and the server completes the exchange without telling
 * this page. So the page watches for the account to appear instead: it
 * snapshots the provider's account ids before opening the tab and polls
 * /subscriptions until an unfamiliar one shows up. That is what lets the
 * step advance "on its own" rather than asking the operator to refresh.
 */
import { useCallback, useEffect, useState } from 'react'
import dayjs from '@/lib/dayjs'
import type { AuthFailure } from './ConnectAuthStep'
import {
  ensureProvider,
  importCredentials,
  oauthKindOf,
  saveNewApiKey,
  startOAuth,
  submitManualCallback
} from './connect-actions'
import type { CatalogEntry } from './types'
import type { ProvidersData } from './useProvidersData'

const POLL_MS = 3_000

export type ConnectStep = 1 | 2 | 3

export type ConnectFlow = ReturnType<typeof useConnectFlow>

export function useConnectFlow(data: ProvidersData | null, reload: () => Promise<void>) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [step, setStep] = useState<ConnectStep>(1)
  const [pending, setPending] = useState(false)
  const [baseline, setBaseline] = useState<ReadonlySet<string>>(new Set())
  const [manualUrl, setManualUrl] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

  const entry = data === null || selectedName === null ? undefined : data.catalog.find((e) => e.name === selectedName)
  const provider =
    data === null || selectedName === null ? undefined : data.providers.find((p) => p.name === selectedName)
  const subscription = data === null || selectedName === null ? undefined : data.subscriptions.get(selectedName)
  const oauthKind = entry === undefined ? null : oauthKindOf(entry)

  // Re-read while an exchange is outstanding; the completing tab has no
  // channel back to this one.
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => {
      reload().catch(() => {
        // A dropped poll is not a flow failure — the next tick retries.
      })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [pending, reload])

  useEffect(() => {
    if (!pending || subscription === undefined) return
    if (subscription.accounts.some((a) => !baseline.has(a.id))) {
      setPending(false)
      setStep(3)
    }
  }, [pending, subscription, baseline])

  const guard = useCallback(async (work: () => Promise<void>) => {
    setBusy(true)
    setSessionError(null)
    try {
      await work()
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const selectVendor = useCallback((next: CatalogEntry) => {
    setSelectedName(next.name)
    setStep(2)
    setPending(false)
    setManualUrl('')
    setApiKeyDraft('')
    setSessionError(null)
  }, [])

  const signIn = useCallback(() => {
    if (entry === undefined || oauthKind === null) return
    guard(async () => {
      // The row has to exist first, or the callback drops the account.
      await ensureProvider(entry)
      await reload()
      setBaseline(new Set(subscription === undefined ? [] : subscription.accounts.map((a) => a.id)))
      await startOAuth(oauthKind)
      setPending(true)
    })
  }, [entry, oauthKind, guard, reload, subscription])

  const importFile = useCallback(
    (file: File) => {
      if (entry === undefined || oauthKind === null) return
      guard(async () => {
        await ensureProvider(entry)
        await importCredentials(oauthKind, file)
        await reload()
        setPending(false)
        setStep(3)
      })
    },
    [entry, oauthKind, guard, reload]
  )

  const submitManual = useCallback(() => {
    guard(async () => {
      await submitManualCallback(manualUrl)
      await reload()
      setPending(false)
      setManualUrl('')
      setStep(3)
    })
  }, [manualUrl, guard, reload])

  const saveApiKey = useCallback(() => {
    if (entry === undefined) return
    guard(async () => {
      await saveNewApiKey(entry, apiKeyDraft)
      await reload()
      setStep(3)
    })
  }, [entry, apiKeyDraft, guard, reload])

  // An error raised in this session outranks the stored one: it describes
  // the attempt the operator just made.
  const storedFailure = ((): AuthFailure | null => {
    if (subscription === undefined) return null
    const failed = subscription.accounts.find((a) => a.authError !== null)
    if (failed === undefined || failed.authError === null) return null
    return {
      message: failed.authError,
      at: failed.authCheckedAt === null ? null : dayjs(failed.authCheckedAt).toISOString()
    }
  })()
  const failure = sessionError === null ? storedFailure : { message: sessionError, at: null }

  return {
    entry,
    provider,
    oauthKind,
    step,
    setStep,
    pending,
    busy,
    failure,
    manualUrl,
    setManualUrl,
    apiKeyDraft,
    setApiKeyDraft,
    selectVendor,
    signIn,
    importFile,
    submitManual,
    saveApiKey
  }
}
