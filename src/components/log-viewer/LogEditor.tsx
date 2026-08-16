import Editor from '@monaco-editor/react'
import { MONACO_FONT_FAMILY } from '@/lib/monaco-font'

interface LogEditorProps {
  value: string
  isDark: boolean
  onMount: (editor: any) => void
}

// Read-only Monaco view of the currently selected logs, with a glyph-margin
// debug button wired up via `onMount` (see lib/log-viewer/monaco-debug-gutter).
export function LogEditor({ value, isDark, onMount }: LogEditorProps) {
  return (
    <div className='relative h-full'>
      <Editor
        height='100%'
        defaultLanguage='json'
        value={value}
        theme={isDark ? 'vs-dark' : 'vs'}
        options={{
          minimap: { enabled: true },
          fontFamily: MONACO_FONT_FAMILY,
          fontSize: 14,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'on',
          readOnly: true,
          lineNumbers: 'on',
          folding: true,
          renderWhitespace: 'all',
          glyphMargin: true
        }}
        onMount={onMount}
      />
    </div>
  )
}
