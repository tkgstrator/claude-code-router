/**
 * Routing Map — view and edit the Router config as a graph. Read-only by
 * default (scenario lanes → target models, with each scenario's primary
 * and fallback chain); the Edit toggle turns on the interactive editor
 * (drag to wire, reconnect / right-click / Delete to remove edges, a side
 * panel for force/threshold/margin and fallback reordering, persona, and
 * Save). No traffic overlay — observed traffic lives on the Usage page;
 * this page is purely for viewing and setting the routing.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Switch } from '@/components/ui/switch'
import { useConfig } from './ConfigProvider'
import { RoutingEditor } from './RoutingEditor'

export function RoutingMap() {
  const { config } = useConfig()
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)

  if (!config) return null

  return (
    <PageContainer>
      <PageHeader
        title={t('routingMap.title')}
        extra={
          <label htmlFor='routing-edit' className='flex items-center gap-2 text-xs text-muted-foreground'>
            <Switch id='routing-edit' checked={isEditing} onCheckedChange={setIsEditing} />
            {t('routingMap.editMode')}
          </label>
        }
      />
      {/* Remount on mode switch so toggling back to view discards any
          unsaved edits (the editor seeds its state from config.Router). */}
      <RoutingEditor key={isEditing ? 'edit' : 'view'} config={config} editable={isEditing} />
    </PageContainer>
  )
}
