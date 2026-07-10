/**
 * Response-side transformer chain.
 *
 * Runs the provider- and model-level `transformResponseOut` chains in
 * reverse order from the request chain, then the endpoint transformer's
 * final `transformResponseIn` shaping pass.
 */

import type { TransformerContext } from '@/schemas'
import { viewPipelineBody } from '@/schemas'
import type { ResolvedProvider } from '../registry/provider'
import type { Transformer } from '../transformers/base'
import { lookupProviderModelBlock } from './request-chain'

export async function processResponseTransformers(
  requestBody: unknown,
  response: Response,
  provider: ResolvedProvider,
  transformer: Transformer,
  bypass: boolean,
  context: TransformerContext
): Promise<Response> {
  if (bypass) return response

  let finalResponse = response

  // Provider-level response chain (reverse order from request chain).
  const providerTx = provider.transformer
  const providerUse = Array.isArray(providerTx?.use) ? [...providerTx.use].reverse() : []
  for (const step of providerUse) {
    finalResponse = await step.transformResponseOut(finalResponse, context)
  }

  // Model-specific response chain (also reversed).
  const view = viewPipelineBody(requestBody)
  const modelBlock = lookupProviderModelBlock(providerTx, view.model)
  const reverseModelUse = modelBlock?.use ? [...modelBlock.use].reverse() : []
  for (const step of reverseModelUse) {
    finalResponse = await step.transformResponseOut(finalResponse, context)
  }

  // Endpoint transformer's final shaping pass.
  return transformer.transformResponseIn(finalResponse, context)
}
