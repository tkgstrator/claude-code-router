/**
 * Settings → Advanced. The raw config document, a request scratchpad and
 * the health probe.
 *
 * Absorbs `JsonEditor` (the config document) and is the intended home
 * for `DebugPage` (the scratchpad). The mock designs only the config
 * tab; the scratchpad still lives on its legacy route and is linked
 * rather than reimplemented against a design that does not exist yet.
 *
 * Tab state rides on the query string so each tab is linkable and the
 * shared `Tabs` primitive can stay a plain list of links. The pane opens
 * straight into the strip — hence `showHeading={false}`.
 */
import { useSearchParams } from 'react-router-dom'
import { Tabs } from '@/components/rialto/primitives'
import { ConfigDocument } from '@/components/rialto/settings/advanced/ConfigDocument'
import { DangerZone } from '@/components/rialto/settings/advanced/DangerZone'
import { HealthPanel } from '@/components/rialto/settings/advanced/HealthPanel'
import { SectionHead } from '@/components/rialto/settings/fields'
import { NotYetAvailable } from '@/components/rialto/settings/notice'
import { SettingsLayout } from '@/components/rialto/settings/SettingsLayout'

const TABS = [
  { id: 'config', label: 'Config document', href: '?tab=config' },
  { id: 'scratch', label: 'Request scratchpad', href: '?tab=scratch' },
  { id: 'health', label: 'Health', href: '?tab=health' }
]

function ScratchpadPanel() {
  return (
    <>
      <SectionHead title='Request scratchpad' meta='not rebuilt yet' />
      <div className='px-6 py-4'>
        <NotYetAvailable
          what='Scratchpad in this shell'
          needs={
            <>
              The HTTP scratchpad still runs on its own route at <span className='font-mono'>/debug</span> — a working
              screen, but one the Rialto mocks never designed, so it has not been folded in here. Rebuilding it inside
              this tab needs a design pass before an implementation pass.
            </>
          }
        />
      </div>
    </>
  )
}

export function SettingsAdvanced() {
  const [params] = useSearchParams()
  const requested = params.get('tab')
  const tab = requested === 'scratch' || requested === 'health' ? requested : 'config'

  return (
    <SettingsLayout
      active='advanced'
      title='Advanced'
      subtitle='config document · scratchpad · health'
      showHeading={false}
    >
      <div className='flex items-center gap-1 border-b border-border px-6'>
        <Tabs items={TABS} active={tab} />
      </div>

      {tab === 'config' ? <ConfigDocument /> : tab === 'health' ? <HealthPanel /> : <ScratchpadPanel />}

      <DangerZone />
      <div className='h-10' />
    </SettingsLayout>
  )
}
