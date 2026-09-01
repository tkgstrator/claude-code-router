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
import { Trans, useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Tabs } from '@/components/rialto/primitives'
import { ConfigDocument } from '@/components/rialto/settings/advanced/ConfigDocument'
import { DangerZone } from '@/components/rialto/settings/advanced/DangerZone'
import { HealthPanel } from '@/components/rialto/settings/advanced/HealthPanel'
import { SectionHead } from '@/components/rialto/settings/fields'
import { NotYetAvailable } from '@/components/rialto/settings/notice'
import { SettingsLayout } from '@/components/rialto/settings/SettingsLayout'

const TAB_KEYS = [
  { id: 'config', labelKey: 'settings.advanced.tabConfig', href: '?tab=config' },
  { id: 'scratch', labelKey: 'settings.advanced.tabScratch', href: '?tab=scratch' },
  { id: 'health', labelKey: 'settings.advanced.tabHealth', href: '?tab=health' }
]

function ScratchpadPanel() {
  const { t } = useTranslation()
  return (
    <>
      <SectionHead title={t('settings.advanced.scratchTitle')} meta={t('settings.advanced.notRebuilt')} />
      <div className='px-6 py-4'>
        <NotYetAvailable
          what={t('settings.advanced.scratchWhat')}
          needs={
            <Trans i18nKey='settings.advanced.scratchNeeds' components={{ mono: <span className='font-mono' /> }} />
          }
        />
      </div>
    </>
  )
}

export function SettingsAdvanced() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const requested = params.get('tab')
  const tab = requested === 'scratch' || requested === 'health' ? requested : 'config'

  return (
    <SettingsLayout
      active='advanced'
      title={t('settings.rail.advanced')}
      subtitle={t('settings.advanced.subtitle')}
      showHeading={false}
    >
      <div className='flex items-center gap-1 border-b border-border px-6'>
        <Tabs
          items={TAB_KEYS.map((item) => ({ id: item.id, label: t(item.labelKey), href: item.href }))}
          active={tab}
        />
      </div>

      {tab === 'config' ? <ConfigDocument /> : tab === 'health' ? <HealthPanel /> : <ScratchpadPanel />}

      <DangerZone />
      <div className='h-10' />
    </SettingsLayout>
  )
}
