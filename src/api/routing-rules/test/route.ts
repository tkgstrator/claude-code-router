/**
 * POST /api/routing-rules/test — dry-run a sample request against a rule
 * stack.
 *
 * Takes the rules in the body rather than reading them from the saved
 * config, so the Rules editor can test the draft the operator is looking
 * at instead of the last thing they saved. Nothing is written.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { RecordSchema, RouteRuleSchema } from '../../../schemas'
import { testRules } from '../../../services/routing-rule-test-service'

const ConditionSchema = z
  .object({
    field: z.enum(['requestedTier', 'requestedModel', 'thinking', 'minTokens', 'maxTokens', 'hasTool', 'effort']),
    expected: z.string().nonempty(),
    // Null when the request presented nothing for this field — which is
    // a different answer from presenting a value that did not match.
    actual: z.string().nonempty().nullable(),
    matched: z.boolean()
  })
  .openapi('RoutingRuleCondition')

const VerdictSchema = z
  .object({
    index: z.number().int().nonnegative(),
    name: z.string().nonempty().nullable(),
    matched: z.boolean(),
    conditions: z.array(ConditionSchema)
  })
  .openapi('RoutingRuleVerdict')

const ResponseSchema = z
  .object({
    matchedIndex: z.number().int().nonnegative().nullable(),
    matchedName: z.string().nonempty().nullable(),
    target: z.string().nonempty().nullable(),
    notEvaluated: z.number().int().nonnegative(),
    evaluated: z.array(VerdictSchema),
    tokenCount: z.number().int().nonnegative()
  })
  .openapi('RoutingRuleTestResponse')

const BodySchema = z
  .object({
    rules: z.array(RouteRuleSchema),
    // The sample request, in the shape a client would POST. Only the
    // fields the predicates read matter (model / messages / system /
    // tools / thinking), but the whole body is accepted so an operator
    // can paste a real captured request straight in.
    request: RecordSchema
  })
  .openapi('RoutingRuleTestRequest')

export const routingRulesTestRoute = new OpenAPIHono()

routingRulesTestRoute.openapi(
  createRoute({
    method: 'post',
    path: '/api/routing-rules/test',
    request: { body: { content: { 'application/json': { schema: BodySchema } } } },
    responses: {
      200: {
        description: 'Which rule the sample request hits, and what the match never reached',
        content: { 'application/json': { schema: ResponseSchema } }
      }
    }
  }),
  async (c) => {
    const { rules, request } = c.req.valid('json')
    const model = typeof request.model === 'string' ? request.model : ''
    return c.json(await testRules(rules, { ...request, model }), 200)
  }
)
