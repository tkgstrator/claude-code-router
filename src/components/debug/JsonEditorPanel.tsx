import MonacoEditor from '@monaco-editor/react'
import { Maximize } from 'lucide-react'
import type { editor } from 'monaco-editor'
import type { MutableRefObject } from 'react'
import { Button } from '@/components/ui/button'

interface JsonEditorPanelProps {
  label: string
  value: string
  onChange: (value: string) => void
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>
  domId: string
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

// Shared Headers/Body Monaco editor pane: a labeled JSON editor that can be
// toggled fullscreen (used identically by both tabs in DebugPage).
export function JsonEditorPanel({
  label,
  value,
  onChange,
  editorRef,
  domId,
  isFullscreen,
  onToggleFullscreen
}: JsonEditorPanelProps) {
  return (
    <div
      className={`${isFullscreen ? '' : 'h-full'} flex flex-col ${
        isFullscreen ? 'fixed bg-background w-[100vw] h-[100vh] z-[9999] top-0 left-0 p-4' : ''
      }`}
    >
      <div className='flex items-center justify-between mb-2'>
        <label className='block text-sm font-medium'>{label}</label>
        <Button variant='ghost' size='sm' onClick={onToggleFullscreen}>
          <Maximize className='h-4 w-4 mr-1' />
          {isFullscreen ? '退出全屏' : '全屏'}
        </Button>
      </div>
      <div
        id={domId}
        className={`${isFullscreen ? 'h-full' : 'flex-1'} border border-gray-300 rounded-md overflow-hidden relative`}
      >
        <MonacoEditor
          height='100%'
          language='json'
          value={value}
          onChange={(v) => onChange(v || '{}')}
          onMount={(editorInstance) => {
            editorRef.current = editorInstance
          }}
          options={{
            minimap: { enabled: isFullscreen },
            scrollBeyondLastLine: false,
            fontSize: 14,
            lineNumbers: 'on',
            wordWrap: 'on',
            automaticLayout: true,
            formatOnPaste: true,
            formatOnType: true
          }}
        />
      </div>
    </div>
  )
}
