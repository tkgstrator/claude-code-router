import type { MutableRefObject } from 'react'

// Wires up Monaco's glyph margin so lines flagged by `getFinalRequestLines`
// render a clickable debug icon. Framework-light (no Monaco types imported)
// since @monaco-editor/react's `onMount` handler is a plain callback.
export function createEditorMountHandler(
  editorRef: MutableRefObject<any>,
  getFinalRequestLines: () => number[],
  onDebugClick: (lineNumber: number) => void
) {
  return (editor: any) => {
    editorRef.current = editor

    // Enable the glyph margin
    editor.updateOptions({
      glyphMargin: true
    })

    // Track the current decoration IDs
    const decorations: { current: string[] } = { current: [] }

    // Apply glyph-margin decorations
    const updateDecorations = () => {
      const finalRequestLines = getFinalRequestLines()
      const nextDecorations = finalRequestLines.map((lineNumber) => ({
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: 1
        },
        options: {
          glyphMarginClassName: 'debug-button-glyph',
          glyphMarginHoverMessage: { value: '点击调试此请求' }
        }
      }))

      // Use deltaDecorations to update decorations properly and clean up stale ones
      decorations.current = editor.deltaDecorations(decorations.current, nextDecorations)
    }

    // Initial decoration pass
    updateDecorations()

    // Listen for glyph-margin clicks - use the proper event channel
    editor.onMouseDown((e: any) => {
      console.log('Mouse down event:', e.target)
      console.log('Event details:', {
        type: e.target.type,
        hasDetail: !!e.target.detail,
        glyphMarginLane: e.target.detail?.glyphMarginLane,
        offsetX: e.target.detail?.offsetX,
        glyphMarginLeft: e.target.detail?.glyphMarginLeft,
        glyphMarginWidth: e.target.detail?.glyphMarginWidth
      })

      // Check whether the click landed in the glyph-margin area
      const isGlyphMarginClick =
        e.target.detail &&
        e.target.detail.glyphMarginLane !== undefined &&
        e.target.detail.offsetX !== undefined &&
        e.target.detail.offsetX <= e.target.detail.glyphMarginLeft + e.target.detail.glyphMarginWidth

      console.log('Is glyph margin click:', isGlyphMarginClick)

      if (e.target.position && isGlyphMarginClick) {
        const finalRequestLines = getFinalRequestLines()
        console.log('Final request lines:', finalRequestLines)
        console.log('Clicked line number:', e.target.position.lineNumber)
        if (finalRequestLines.includes(e.target.position.lineNumber)) {
          console.log('Opening debug page for line:', e.target.position.lineNumber)
          onDebugClick(e.target.position.lineNumber)
        }
      }
    })

    // Use onGlyphMarginClick when available
    if (typeof editor.onGlyphMarginClick === 'function') {
      editor.onGlyphMarginClick((e: any) => {
        console.log('Glyph margin click event:', e)
        const finalRequestLines = getFinalRequestLines()
        if (finalRequestLines.includes(e.target.position.lineNumber)) {
          console.log('Opening debug page for line (glyph):', e.target.position.lineNumber)
          onDebugClick(e.target.position.lineNumber)
        }
      })
    }

    // Use mouse-move events to detect hovering over the debug button
    editor.onMouseMove((e: any) => {
      if (e.target.position && (e.target.type === 4 || e.target.type === 'glyph-margin')) {
        const finalRequestLines = getFinalRequestLines()
        if (finalRequestLines.includes(e.target.position.lineNumber)) {
          // A hover effect could be applied here
          editor.updateOptions({
            glyphMargin: true
          })
        }
      }
    })

    // Refresh decorations as the logs change
    const interval = setInterval(updateDecorations, 1000)

    return () => {
      clearInterval(interval)
      // Clear decorations
      if (editorRef.current) {
        editorRef.current.deltaDecorations(decorations.current, [])
      }
    }
  }
}
