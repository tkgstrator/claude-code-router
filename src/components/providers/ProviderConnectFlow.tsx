import { LogIn } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { ConnectChoiceDialog } from './ConnectChoiceDialog'
import { ImportCredentialsDialog } from './ImportCredentialsDialog'
import { ManualCallbackDialog } from './ManualCallbackDialog'

interface ProviderConnectFlowProps {
  onSubscriptionsSynced: () => Promise<void>
}

// undefined signals "not valid JSON"; JSON.parse never legitimately
// produces undefined from a well-formed document.
async function parseJsonFile(file: File): Promise<unknown> {
  try {
    const text = await file.text()
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Subscription OAuth loopback flow:
// 1. UI asks user to pick a provider (claude or codex) in a dialog.
// 2. Server mints a one-shot state + PKCE pair at
//    /oauth/initiate/<provider> and returns the upstream IdP's
//    authorize URL.
// 3. We open it in a new tab; the consent page redirects the browser
//    back to the provider's whitelisted loopback callback (Hono-served).
// 4. Server completes the token exchange, writes the credentials file,
//    and triggers SubAccount sync. User closes the success tab and
//    refreshes the subscription panel to see the new account.
//
// For remote deployments (non-localhost), the loopback callback cannot
// be reached from the user's browser. In that case we show a dialog
// asking the user to copy the redirect URL from the address bar so the
// server can complete the exchange via /api/oauth/manual-callback.
export function ProviderConnectFlow({ onSubscriptionsSynced }: ProviderConnectFlowProps) {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const isRemoteAccess = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'

  const [connectChoiceOpen, setConnectChoiceOpen] = useState(false)
  const [manualCallbackOpen, setManualCallbackOpen] = useState(false)
  const [manualCallbackUrl, setManualCallbackUrl] = useState('')
  const [manualCallbackLoading, setManualCallbackLoading] = useState(false)
  const [manualCallbackError, setManualCallbackError] = useState<string | null>(null)
  const [importCredOpen, setImportCredOpen] = useState(false)
  const [importCredProvider, setImportCredProvider] = useState<'claude' | 'codex'>('claude')
  const [importCredFile, setImportCredFile] = useState<File | null>(null)
  const [importCredLoading, setImportCredLoading] = useState(false)
  const [importCredError, setImportCredError] = useState<string | null>(null)
  const importCredFileRef = useRef<HTMLInputElement>(null)

  const handleConnectProvider = async (provider: 'claude' | 'codex') => {
    setConnectChoiceOpen(false)
    try {
      const res = await api.post<{ success: boolean; authorizeUrl: string; state: string }>(
        `/oauth/initiate/${provider}`,
        {}
      )
      if (!res.success || !res.authorizeUrl) {
        console.error(t('providers.connect_failed'), res)
        return
      }
      window.open(res.authorizeUrl, '_blank', 'noopener,noreferrer')
      if (provider === 'claude' && isRemoteAccess) {
        setManualCallbackUrl('')
        setManualCallbackError(null)
        setManualCallbackOpen(true)
      }
    } catch (err) {
      console.error(t('providers.connect_failed'), err)
    }
  }

  const handleManualCallback = async () => {
    if (!manualCallbackUrl.trim()) return
    setManualCallbackLoading(true)
    setManualCallbackError(null)
    try {
      const res = await api.post<{ success: boolean; error?: string }>('/oauth/manual-callback', {
        url: manualCallbackUrl.trim()
      })
      if (res.success) {
        setManualCallbackOpen(false)
        await onSubscriptionsSynced()
        showToast(t('providers.oauth_result_success_title'), 'success')
      } else {
        setManualCallbackError(res.error ?? 'Unknown error')
      }
    } catch (err) {
      setManualCallbackError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setManualCallbackLoading(false)
    }
  }

  const handleImportCredentials = async () => {
    setImportCredError(null)
    if (!importCredFile) {
      setImportCredError(t('providers.import_cred_no_file'))
      return
    }
    const parsed = await parseJsonFile(importCredFile)
    if (parsed === undefined) {
      setImportCredError(t('providers.import_cred_invalid_json'))
      return
    }
    setImportCredLoading(true)
    try {
      const res = await api.post<{ success: boolean; error?: string }>('/oauth/import-credentials', {
        provider: importCredProvider,
        credentials: parsed
      })
      if (res.success) {
        setImportCredOpen(false)
        setImportCredFile(null)
        if (importCredFileRef.current) importCredFileRef.current.value = ''
        await onSubscriptionsSynced()
        showToast(t('providers.oauth_result_success_title'), 'success')
      } else {
        setImportCredError(res.error ?? 'Unknown error')
      }
    } catch (err) {
      setImportCredError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setImportCredLoading(false)
    }
  }

  return (
    <>
      <Button variant='outline' onClick={() => setConnectChoiceOpen(true)}>
        <LogIn className='h-4 w-4' />
        {t('providers.connect')}
      </Button>
      <ConnectChoiceDialog
        open={connectChoiceOpen}
        onOpenChange={setConnectChoiceOpen}
        onConnect={handleConnectProvider}
        onImport={() => {
          setConnectChoiceOpen(false)
          setImportCredFile(null)
          setImportCredError(null)
          setImportCredProvider('claude')
          setImportCredOpen(true)
        }}
      />
      <ManualCallbackDialog
        open={manualCallbackOpen}
        onOpenChange={setManualCallbackOpen}
        url={manualCallbackUrl}
        onUrlChange={setManualCallbackUrl}
        error={manualCallbackError}
        loading={manualCallbackLoading}
        onSubmit={handleManualCallback}
      />
      <ImportCredentialsDialog
        open={importCredOpen}
        onOpenChange={setImportCredOpen}
        provider={importCredProvider}
        onProviderChange={setImportCredProvider}
        fileInputRef={importCredFileRef}
        onFileChange={(file) => {
          setImportCredFile(file)
          setImportCredError(null)
        }}
        error={importCredError}
        loading={importCredLoading}
        disabled={!importCredFile}
        onSubmit={handleImportCredentials}
      />
    </>
  )
}
