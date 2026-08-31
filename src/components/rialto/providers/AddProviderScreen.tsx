/**
 * Add provider — one three-step page.
 *
 * Absorbs ConnectChoiceDialog + ProviderConnectFlow + ImportCredentialsDialog
 * + ManualCallbackDialog + ManageProvidersDialog: four dialogs that chained
 * into each other, which is the wrong shape for a flow that branches and
 * that fails often enough to need its failure on screen.
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { toggleModel } from './actions'
import { ConnectAuthStep } from './ConnectAuthStep'
import { ConnectModelsStep } from './ConnectModelsStep'
import { ConnectStepBar } from './ConnectStepBar'
import { ConnectVendorRail } from './ConnectVendorRail'
import { enableProvider } from './connect-actions'
import { type ConnectFlow, type ConnectStep, useConnectFlow } from './useConnectFlow'
import { useProvidersData } from './useProvidersData'
import { vendorLabel } from './vendor-labels'

const NEXT_STEP: Record<ConnectStep, ConnectStep> = { 1: 2, 2: 3, 3: 3 }
const PREV_STEP: Record<ConnectStep, ConnectStep> = { 1: 1, 2: 1, 3: 2 }

function ConnectPane({ flow, now, reload }: { flow: ConnectFlow; now: number; reload: () => Promise<void> }) {
  const { entry, provider } = flow
  if (entry === undefined) {
    return <div className='min-w-0 px-6 py-6 text-xs text-muted-foreground'>Pick a vendor on the left to start.</div>
  }
  if (flow.step === 3) {
    return (
      <ConnectModelsStep
        entry={entry}
        provider={provider}
        onToggle={(model, next) => {
          if (provider === undefined) return
          toggleModel(provider, model, next).then(reload)
        }}
      />
    )
  }
  return (
    <ConnectAuthStep
      entry={entry}
      oauthKind={flow.oauthKind}
      pending={flow.pending}
      busy={flow.busy}
      failure={flow.failure}
      now={now}
      manualUrl={flow.manualUrl}
      apiKeyDraft={flow.apiKeyDraft}
      onSignIn={flow.signIn}
      onImport={flow.importFile}
      onManualUrlChange={flow.setManualUrl}
      onSubmitManual={flow.submitManual}
      onApiKeyChange={flow.setApiKeyDraft}
      onSaveApiKey={flow.saveApiKey}
    />
  )
}

/** Step 1 needs a vendor; step 3 needs the row the earlier steps created. */
const canAdvance = (flow: ConnectFlow): boolean => {
  if (flow.step === 1) return flow.entry !== undefined
  if (flow.step === 3) return flow.provider !== undefined
  return true
}

export function AddProviderScreen() {
  const navigate = useNavigate()
  const { data, error, reload } = useProvidersData()
  const flow = useConnectFlow(data, reload)
  const { step, setStep, provider } = flow

  const cancel = useCallback(() => navigate('/providers'), [navigate])

  const back = useCallback(() => {
    if (step === 1) cancel()
    else setStep(PREV_STEP[step])
  }, [step, setStep, cancel])

  // Step 3's Continue is the only one that commits: the provider row has
  // existed since step 2 (the OAuth callback needs it) but stays switched
  // off until the operator has said which models it may serve.
  const advance = useCallback(async () => {
    if (step !== 3) {
      setStep(NEXT_STEP[step])
      return
    }
    if (provider === undefined) return
    await enableProvider(provider)
    navigate(`/providers/${encodeURIComponent(provider.name)}`)
  }, [step, setStep, provider, navigate])

  const subtitle =
    flow.entry === undefined
      ? `Step ${step} of 3`
      : `Step ${step} of 3 · ${vendorLabel(flow.entry.name, flow.entry.displayName)}`

  return (
    <Screen
      title='Add provider'
      subtitle={subtitle}
      actions={
        <>
          <RButton variant='ghost' icon='ri-arrow-left-line' onClick={back}>
            Back
          </RButton>
          <RButton
            variant='primary'
            icon='ri-arrow-right-line'
            onClick={advance}
            disabled={!canAdvance(flow) || flow.busy}
          >
            {step === 3 ? 'Finish' : 'Continue'}
          </RButton>
        </>
      }
    >
      <ConnectStepBar current={step} onCancel={cancel} />
      {error !== null ? (
        <div className='px-6 py-6 text-xs text-destructive'>{error}</div>
      ) : data === null ? (
        <div className='px-6 py-6 text-xs text-muted-foreground'>Loading…</div>
      ) : (
        <div className='grid h-full grid-cols-[22rem_1fr]'>
          <ConnectVendorRail
            entries={data.catalog}
            selectedName={flow.entry === undefined ? null : flow.entry.name}
            onSelect={flow.selectVendor}
          />
          <ConnectPane flow={flow} now={data.now} reload={reload} />
        </div>
      )}
    </Screen>
  )
}
