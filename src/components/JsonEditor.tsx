import Editor from '@monaco-editor/react'
import { Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfig } from '@/components/ConfigProvider'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

interface JsonEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  showToast?: (message: string, type: 'success' | 'error' | 'warning') => void
}

export function JsonEditor({ open, onOpenChange, showToast }: JsonEditorProps) {
  const { t } = useTranslation()
  const { reloadConfig } = useConfig()
  const [jsonValue, setJsonValue] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  const containerRef = useRef<HTMLDivElement>(null)

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
    if (!open) return
    let cancelled = false
    const load = async () => {
      try {
        const raw = await api.getConfig()
        if (!cancelled) setJsonValue(JSON.stringify(raw, null, 2))
      } catch (error) {
        console.error('Failed to load config:', error)
        if (!cancelled && showToast) {
          showToast(t('app.config_saved_failed') + ': ' + (error as Error).message, 'error')
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, showToast, t])

  // Handle open/close animations
  useEffect(() => {
    if (open) {
      setIsVisible(true)
      // Trigger the animation after a small delay to ensure the element is rendered
      requestAnimationFrame(() => {
        setIsAnimating(true)
      })
    } else {
      setIsAnimating(false)
      // Wait for the animation to complete before hiding
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleSaveResponse = (response: unknown, successMessage: string, errorMessage: string) => {
    // Surface a toast based on the response payload
    if (response && typeof response === 'object' && 'success' in response) {
      const apiResponse = response as { success: boolean; message?: string }
      if (apiResponse.success) {
        if (showToast) {
          showToast(apiResponse.message || successMessage, 'success')
        }
        return true
      } else {
        if (showToast) {
          showToast(apiResponse.message || errorMessage, 'error')
        }
        return false
      }
    } else {
      // Default to success toast
      if (showToast) {
        showToast(successMessage, 'success')
      }
      return true
    }
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
        onOpenChange(false)
      }
    } catch (error) {
      console.error('Failed to save config:', error)
      if (showToast) {
        showToast(t('app.config_saved_failed') + ': ' + (error as Error).message, 'error')
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (!isVisible && !open) {
    return null
  }

  return (
    <>
      {(isVisible || open) && (
        <div
          className={`fixed inset-0 z-50 transition-all duration-300 ease-out ${
            isAnimating && open ? 'bg-black/50 opacity-100' : 'bg-black/0 opacity-0 pointer-events-none'
          }`}
          onClick={() => onOpenChange(false)}
        />
      )}

      <div
        ref={containerRef}
        className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-background shadow-2xl transition-all duration-300 ease-out transform ${
          isAnimating && open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          height: '100vh',
          maxHeight: '100vh'
        }}
      >
        <div className='flex items-center justify-between border-b p-4'>
          <h2 className='text-lg font-semibold'>{t('json_editor.title')}</h2>
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' onClick={() => onOpenChange(false)} disabled={isSaving}>
              <X className='h-4 w-4 mr-2' />
              {t('json_editor.cancel')}
            </Button>
            <Button variant='outline' size='sm' onClick={handleSave} disabled={isSaving}>
              <Save className='h-4 w-4 mr-2' />
              {isSaving ? t('json_editor.saving') : t('json_editor.save')}
            </Button>
          </div>
        </div>

        <div className='flex-1 min-h-0'>
          <Editor
            height='100%'
            defaultLanguage='json'
            value={jsonValue}
            onChange={(value) => setJsonValue(value || '')}
            theme={isDark ? 'vs-dark' : 'vs'}
            options={{
              minimap: { enabled: true },
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
      </div>
    </>
  )
}
