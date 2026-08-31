/**
 * Field editor for the selected module.
 *
 * The old properties panel was the third column of a modal, so it could
 * only show fields; here it sits under the preview, which is what makes
 * a colour or format change judgeable without saving first.
 */
import { Pill } from '@/components/rialto/primitives'
import { BG_SWATCHES, colorHex, FG_SWATCHES, moduleMeta, type Swatch } from '@/lib/rialto/settings-content/statusline'
import { cn } from '@/lib/utils'
import type { StatusLineModuleConfig } from '@/types'

type Field = keyof StatusLineModuleConfig

const FIELD_CLASS =
  'flex h-8 items-center rounded-md border border-border bg-transparent px-3 font-mono text-xs outline-none focus:border-foreground/40'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className='grid grid-cols-[10rem_1fr] items-start gap-4 border-t border-border/60 px-6 py-3'>
      {hint === undefined ? (
        <span className='text-xs'>{label}</span>
      ) : (
        <div>
          <div className='text-xs'>{label}</div>
          <div className='mt-0.5 text-[11px] text-muted-foreground'>{hint}</div>
        </div>
      )}
      <div>{children}</div>
    </div>
  )
}

function ColorField({
  swatches,
  value,
  onChange
}: {
  swatches: Swatch[]
  value: string | undefined
  onChange: (next: string) => void
}) {
  const hex = colorHex(value)
  return (
    <div className='flex items-center gap-1.5'>
      {swatches.map((option) => (
        <button
          key={option.value}
          type='button'
          aria-label={option.value}
          title={option.value}
          onClick={() => onChange(option.value)}
          style={{ backgroundColor: option.hex }}
          className={cn(
            'size-6 rounded',
            option.value === value ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : ''
          )}
        />
      ))}
      <input
        value={hex === null ? '' : hex}
        onChange={(e) => onChange(e.target.value)}
        placeholder='#38bdf8'
        aria-label='Hex colour'
        className={cn(FIELD_CLASS, 'ml-2 w-24 px-2.5 text-[11px]')}
      />
    </div>
  )
}

export function ModuleProperties({
  module,
  onChange
}: {
  module: StatusLineModuleConfig | null
  onChange: (field: Field, value: string) => void
}) {
  if (module === null) {
    return (
      <div className='px-6 py-5 text-xs text-muted-foreground'>
        Select a module in the line to edit its icon, colour and format.
      </div>
    )
  }
  const meta = moduleMeta(module.type)
  return (
    <>
      <div className='flex items-center gap-2 px-6 pt-5 pb-3'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>{meta.label} module</h3>
        <Pill tone='info'>selected</Pill>
      </div>

      <Row label='Icon'>
        <div className='flex items-center gap-2'>
          <div className='flex size-8 items-center justify-center rounded-md border border-border text-sm'>
            {module.icon === undefined || module.icon === '' ? (
              <i className={`${meta.icon} text-sm text-muted-foreground`} />
            ) : (
              module.icon
            )}
          </div>
          <div className='flex h-8 w-44 items-center gap-2 rounded-md border border-border px-2.5 text-xs'>
            <i className='ri-search-line text-sm text-muted-foreground' />
            <input
              value={module.icon === undefined ? '' : module.icon}
              onChange={(e) => onChange('icon', e.target.value)}
              placeholder='Nerd Font glyph'
              aria-label='Module icon'
              className='w-full bg-transparent outline-none placeholder:text-muted-foreground'
            />
          </div>
        </div>
      </Row>

      <Row label='Color'>
        <ColorField swatches={FG_SWATCHES} value={module.color} onChange={(v) => onChange('color', v)} />
      </Row>

      <Row label='Background' hint='Painted only under the powerline style.'>
        <ColorField swatches={BG_SWATCHES} value={module.background} onChange={(v) => onChange('background', v)} />
      </Row>

      <Row label='Format' hint='{{model}}, {{gitBranch}}, {{workDirName}}, {{inputTokens}}, {{outputTokens}}.'>
        <input
          value={module.text}
          onChange={(e) => onChange('text', e.target.value)}
          aria-label='Module format'
          className={cn(FIELD_CLASS, 'w-full max-w-sm')}
        />
      </Row>

      {module.type === 'script' ? (
        <Row label='Script' hint='Executed each turn; its stdout replaces the module text.'>
          <input
            value={module.scriptPath === undefined ? '' : module.scriptPath}
            onChange={(e) => onChange('scriptPath', e.target.value)}
            placeholder='/usr/local/bin/my-segment'
            aria-label='Script path'
            className={cn(FIELD_CLASS, 'w-full max-w-sm')}
          />
        </Row>
      ) : null}
    </>
  )
}
