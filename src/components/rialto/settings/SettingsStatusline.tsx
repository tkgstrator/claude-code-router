/**
 * Settings → Status line.
 *
 * Absorbs `StatusLineConfigDialog` and its six sub-components. It was a
 * modal with three cramped columns; it is a three-pane editor now because
 * you cannot judge a status line without seeing it rendered, and a modal
 * that tall left no room for both the line and its properties.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useConfig } from '@/components/ConfigProvider'
import { RButton } from '@/components/rialto/primitives'
import { api } from '@/lib/api'
import { moveModule } from '@/lib/rialto/settings-content/statusline'
import { createModuleForType, getCurrentModules, removeModuleAt, withCurrentModules } from '@/lib/statusline/modules'
import type { Config, StatusLineConfig, StatusLineModuleConfig } from '@/types'
import { createDefaultStatusLineConfig } from '@/utils/statusline'
import { SettingsLayout } from './SettingsLayout'
import { LineColumn } from './statusline/LineColumn'
import { LinePreview } from './statusline/LinePreview'
import { ModulePalette } from './statusline/ModulePalette'
import { ModuleProperties } from './statusline/ModuleProperties'

function WireUpNote() {
  return (
    <div className='px-6 py-5'>
      <div className='rounded-md border border-dashed border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
        <i className='ri-terminal-line mr-1 align-[-1px]' />
        Wire it up in <span className='font-mono'>~/.claude/settings.json</span>:{' '}
        <span className='font-mono'>{'"statusLine": { "type": "command", "command": "rialto statusline" }'}</span>
      </div>
    </div>
  )
}

function StatuslineEditor({ config }: { config: Config }) {
  const { reloadConfig } = useConfig()
  // Memoised because it seeds the draft: a fresh default object on every
  // render would make the re-sync effect below fire forever.
  const persisted = useMemo(
    () => (config.StatusLine === undefined ? createDefaultStatusLineConfig() : config.StatusLine),
    [config.StatusLine]
  )

  const [draft, setDraft] = useState<StatusLineConfig>(persisted)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = useCallback(() => {
    setDraft(persisted)
    setSelectedIndex(null)
  }, [persisted])

  useEffect(reset, [reset])

  const modules = getCurrentModules(draft)
  const selected = selectedIndex === null ? null : modules[selectedIndex]

  const setModules = useCallback((next: StatusLineModuleConfig[]) => {
    setDraft((prev) => withCurrentModules(prev, next))
  }, [])

  const add = useCallback(
    (type: string) => {
      const next = [...getCurrentModules(draft), createModuleForType(type)]
      setModules(next)
      setSelectedIndex(next.length - 1)
    },
    [draft, setModules]
  )

  const remove = useCallback(
    (index: number) => {
      setModules(removeModuleAt(getCurrentModules(draft), index))
      setSelectedIndex((prev) => (prev === index ? null : prev))
    },
    [draft, setModules]
  )

  const reorder = useCallback(
    (from: number, to: number) => {
      setModules(moveModule(getCurrentModules(draft), from, to))
      setSelectedIndex(to)
    },
    [draft, setModules]
  )

  const patchSelected = useCallback(
    (field: keyof StatusLineModuleConfig, value: string) => {
      if (selectedIndex === null) return
      setModules(getCurrentModules(draft).map((m, i) => (i === selectedIndex ? { ...m, [field]: value } : m)))
    },
    [draft, selectedIndex, setModules]
  )

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await api.updateConfig({ ...config, StatusLine: draft })
      await reloadConfig()
      toast.success('Status line saved')
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [config, draft, reloadConfig])

  const dirty = JSON.stringify(draft) !== JSON.stringify(persisted)

  return (
    <SettingsLayout
      active='statusline'
      title='Status line'
      subtitle={`${modules.length} modules · rialto statusline`}
      // Opens straight into the module palette: the four panes are one
      // continuous editor, and a heading above them would offset only the
      // rightmost column.
      showHeading={false}
      actions={
        <>
          <RButton variant='ghost' onClick={reset} disabled={!dirty || saving}>
            Discard
          </RButton>
          <RButton variant='primary' icon='ri-check-line' onClick={save} disabled={!dirty || saving}>
            Save
          </RButton>
        </>
      }
    >
      <div className='grid h-full grid-cols-[13rem_15rem_1fr]'>
        <ModulePalette onAdd={add} />
        <LineColumn
          modules={modules}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onRemove={remove}
          onReorder={reorder}
        />
        <div className='min-w-0 overflow-y-auto'>
          <LinePreview
            modules={modules}
            style={draft.currentStyle}
            onStyleChange={(currentStyle) => {
              setDraft((prev) => ({ ...prev, currentStyle }))
              setSelectedIndex(null)
            }}
          />
          <ModuleProperties module={selected === undefined ? null : selected} onChange={patchSelected} />
          <WireUpNote />
          <div className='h-6' />
        </div>
      </div>
    </SettingsLayout>
  )
}

export function SettingsStatusline() {
  const { config } = useConfig()
  if (config === null) {
    return (
      <SettingsLayout active='statusline' title='Status line' showHeading={false}>
        <div className='px-6 py-6 text-xs text-muted-foreground'>Loading…</div>
      </SettingsLayout>
    )
  }
  return <StatuslineEditor config={config} />
}
