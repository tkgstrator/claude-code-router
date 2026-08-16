import Editor from '@monaco-editor/react'
import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { useConfig } from '@/components/ConfigProvider'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { MONACO_FONT_FAMILY } from '@/lib/monaco-font'

export function JsonEditor() {
  const { t } = useTranslation()
  const { reloadConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [jsonValue, setJsonValue] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Load the editor from the RAW /api/config wire JSON (which carries
  // explicit nulls for unset api_key / path scalars / router slots), not
  // the provider's normalized Config (which coerces null -> '' for the
  // app's controlled inputs). The editor should show the truth on disk.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const raw = await api.getConfig()
        if (!cancelled) setJsonValue(JSON.stringify(raw, null, 2))
      } catch (error) {
        console.error('Failed to load config:', error)
        if (!cancelled) showToast(t('app.config_saved_failed') + ': ' + (error as Error).message, 'error')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [showToast, t])

  const handleSaveResponse = (response: unknown, successMessage: string, errorMessage: string) => {
    // Surface a toast based on the response payload
    if (response && typeof response === 'object' && 'success' in response) {
      const apiResponse = response as { success: boolean; message?: string }
      if (apiResponse.success) {
        showToast(apiResponse.message || successMessage, 'success')
        return true
      }
      showToast(apiResponse.message || errorMessage, 'error')
      return false
    }
    // Default to success toast
    showToast(successMessage, 'success')
    return true
  }

  const handleSave = async () => {
    if (!jsonValue) return

    try {
      setIsSaving(true)
      const parsedConfig = JSON.parse(jsonValue)
      const response = await api.updateConfig(parsedConfig)

      const success = handleSaveResponse(response, t('app.config_saved_success'), t('app.config_saved_failed'))

      if (success) {
        // Re-fetch and re-normalize the shared config rather than
        // pushing the raw parsed JSON (which may carry nulls for unset
        // api_key / path scalars / router slots). Feeding raw nulls into
        // the shared Config would break other screens' controlled
        // inputs (e.g. SettingsDialog binds value={config.CLAUDE_PATH}
        // with no fallback). reloadConfig applies the same normalization
        // the provider does on mount, so other panels stay consistent.
        await reloadConfig()
      }
    } catch (error) {
      console.error('Failed to save config:', error)
      showToast(t('app.config_saved_failed') + ': ' + (error as Error).message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader title={t('json_editor.title')}>
        <Button variant='outline' size='sm' onClick={handleSave} disabled={isSaving}>
          <Save className='h-4 w-4 mr-2' />
          {isSaving ? t('json_editor.saving') : t('json_editor.save')}
        </Button>
      </PageHeader>

      <div className='flex-1 min-h-0'>
        <Editor
          height='100%'
          defaultLanguage='json'
          value={jsonValue}
          onChange={(value) => setJsonValue(value || '')}
          theme={isDark ? 'vs-dark' : 'vs'}
          options={{
            minimap: { enabled: true },
            fontFamily: MONACO_FONT_FAMILY,
            fontSize: 14,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            formatOnPaste: true,
            formatOnType: true,
            suggest: {
              showKeywords: true,
              showSnippets: true
            }
          }}
        />
      </div>
    </PageContainer>
  )
}
