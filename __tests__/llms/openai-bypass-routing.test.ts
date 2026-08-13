/**
 * OpenAI-compat inbound paths bypass the scenario router entirely: the
 * caller's `body.model` reaches upstream verbatim, no scenario primary
 * / rule / persona / quota-aware selection runs.
 *
 * Anthropic inbound (/v1/messages) and legacy callers without an
 * inboundPath keep the pre-existing routing behaviour.
 */

import { describe, expect, test } from 'bun:test'
import pino from 'pino'
import { ConfigStore } from '../../src/llms/registry/config'
import { TokenizerRegistry } from '../../src/llms/registry/tokenizer'
import { routeScenario } from '../../src/llms/scenario-router'
import type { RouterRequest } from '../../src/llms/scenario-router/types'

const log = pino({ level: 'silent' })

async function runRouter(path: string | undefined, bodyModel: string): Promise<RouterRequest> {
  const config = new ConfigStore({
    Providers: [
      {
        name: 'anthropic',
        auth_mode: 'api_key',
        api_key: 'sk-x',
        api_base_url: 'https://api.anthropic.com/v1/messages',
        models: ['claude-sonnet-5']
      },
      {
        name: 'openai',
        auth_mode: 'api_key',
        api_key: 'sk-y',
        api_base_url: 'https://api.openai.com/v1/chat/completions',
        models: ['gpt-5']
      }
    ],
    providers: [
      {
        name: 'anthropic',
        auth_mode: 'api_key',
        api_key: 'sk-x',
        api_base_url: 'https://api.anthropic.com/v1/messages',
        models: ['claude-sonnet-5']
      },
      {
        name: 'openai',
        auth_mode: 'api_key',
        api_key: 'sk-y',
        api_base_url: 'https://api.openai.com/v1/chat/completions',
        models: ['gpt-5']
      }
    ],
    Router: {
      default: 'anthropic,claude-sonnet-5',
      agentFallbacks: { default: ['anthropic,claude-sonnet-5'] }
    }
  })
  const tokenizers = new TokenizerRegistry(log)
  await tokenizers.initialize()
  const req: RouterRequest = {
    body: { model: bodyModel, messages: [{ role: 'user', content: 'hi' }] } as RouterRequest['body'],
    log,
    inboundPath: path
  }
  await routeScenario(req, { config, tokenizers })
  return req
}

describe('routeScenario — OpenAI-compat bypass', () => {
  test('/v1/chat/completions keeps body.model verbatim (no rewrite to Router.default)', async () => {
    const req = await runRouter('/v1/chat/completions', 'openai,gpt-5')
    expect(req.body.model).toBe('openai,gpt-5')
    expect(req.scenarioType).toBe('default')
    expect(req.resolvedFallbacks).toEqual([])
    expect(req.isSubagent).toBe(false)
  })

  test('/v1/responses keeps body.model verbatim', async () => {
    const req = await runRouter('/v1/responses', 'openai,gpt-5')
    expect(req.body.model).toBe('openai,gpt-5')
    expect(req.scenarioType).toBe('default')
    expect(req.resolvedFallbacks).toEqual([])
  })

  test('/v1/messages does NOT bypass — full router runs (tokenCount stamped)', async () => {
    // The bypass early-return skips the countRequestTokens call, so
    // req.tokenCount stays undefined; on /v1/messages the router runs
    // it and stamps a numeric value. This is the cleanest discriminator
    // that doesn't depend on any Router config shape.
    const req = await runRouter('/v1/messages', 'openai,gpt-5')
    expect(typeof req.tokenCount).toBe('number')
  })

  test('missing inboundPath (legacy caller) also does NOT bypass — backward compat', async () => {
    const req = await runRouter(undefined, 'openai,gpt-5')
    expect(typeof req.tokenCount).toBe('number')
  })
})
