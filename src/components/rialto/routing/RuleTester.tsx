/**
 * Try a sample request against the rule stack the operator is editing.
 *
 * This is the payoff of giving rules their own screen: first-match-wins
 * ordering is close to impossible to reason about by reading, and the
 * runtime is the only other thing that can answer the question.
 *
 * The rules travel in the request body rather than being read from the
 * saved config, so the answer describes the draft on screen — testing the
 * last save would be the one answer that is never useful. The server walks
 * them with the router's own predicate code over the real token count, so
 * what this panel shows is what the router does.
 */
import { useCallback, useState } from 'react'
import { Pill, RButton } from '@/components/rialto/primitives'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { RouteRule } from '@/schemas'
import type { ConditionField, RuleCondition, RuleTestResult, RuleVerdict } from './rules'

const SAMPLE = '{"model": "claude-haiku-4-5", "messages": []}'

const parse = (text: string): { ok: true; body: Record<string, unknown> } | { ok: false } => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false }
    return { ok: true, body: { ...parsed } }
  } catch {
    return { ok: false }
  }
}

/**
 * What "the request presented nothing" means for each field.
 *
 * A dash would collapse it with "presented a value that did not match",
 * and those are different problems: one is a request that never carried
 * the signal, the other is a rule looking for a different value.
 */
const ABSENT_COPY: Record<ConditionField, string> = {
  requestedTier: 'no tier could be derived from the model',
  requestedModel: 'no model on the request',
  thinking: 'no thinking field on the request',
  minTokens: 'no token count',
  maxTokens: 'no token count',
  hasTool: 'no tools on the request',
  effort: 'no effort on the request'
}

function ConditionRow({ condition }: { condition: RuleCondition }) {
  return (
    <div className='flex items-baseline gap-2 py-0.5 text-[11px]'>
      <i
        className={cn(
          'shrink-0 text-xs',
          condition.matched ? 'ri-check-line text-emerald-600 dark:text-emerald-400' : 'ri-close-line text-destructive'
        )}
      />
      <span className='w-28 shrink-0 truncate font-mono text-muted-foreground'>{condition.field}</span>
      <span className='min-w-0 truncate font-mono'>{condition.expected}</span>
      {condition.actual === null ? (
        <span className='ml-auto shrink-0 text-right text-muted-foreground'>{ABSENT_COPY[condition.field]}</span>
      ) : (
        <span className='ml-auto shrink-0 truncate text-right font-mono text-muted-foreground'>
          got {condition.actual}
        </span>
      )}
    </div>
  )
}

/**
 * One rule's verdict. When exactly one condition failed, the header names
 * it — that single field is almost always the answer the operator came for.
 */
function RuleTrace({ verdict, first }: { verdict: RuleVerdict; first: boolean }) {
  const failed = verdict.conditions.filter((c) => !c.matched)
  const only = failed.length === 1 ? failed[0].field : null
  return (
    <div
      className={cn(
        'border-l-2 px-3 py-2 transition-colors hover:bg-muted/50',
        first ? '' : 'border-t border-t-border/60',
        verdict.matched ? 'border-l-foreground bg-muted/40' : 'border-l-transparent'
      )}
    >
      <div className='flex items-center gap-2 text-[11px]'>
        <span className='font-mono tabular-nums text-muted-foreground'>{verdict.index + 1}</span>
        <span className='truncate'>{verdict.name === null ? `Rule ${verdict.index + 1}` : verdict.name}</span>
        <span
          className={cn(
            'ml-auto shrink-0',
            verdict.matched ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
          )}
        >
          {verdict.matched ? 'match' : only === null ? 'no match' : `no match · ${only}`}
        </span>
      </div>
      {verdict.conditions.length === 0 ? (
        <div className='mt-1 text-[11px] text-muted-foreground'>no conditions — matches every request</div>
      ) : (
        <div className='mt-1'>
          {verdict.conditions.map((condition) => (
            <ConditionRow key={condition.field} condition={condition} />
          ))}
        </div>
      )}
    </div>
  )
}

function Trace({ result }: { result: RuleTestResult }) {
  if (result.evaluated.length === 0) return null
  return (
    <div className='mt-3 overflow-hidden rounded-md border border-border'>
      {result.evaluated.map((verdict, i) => (
        <RuleTrace key={verdict.index} verdict={verdict} first={i === 0} />
      ))}
      {result.notEvaluated === 0 ? null : (
        <div className='border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground'>
          evaluation stopped here
        </div>
      )}
    </div>
  )
}

function TokenLine({ count }: { count: number }) {
  return (
    <div className='mt-2 text-[11px] text-muted-foreground'>
      {`${count.toLocaleString()} tokens — the count size predicates were measured against`}
    </div>
  )
}

/**
 * Nothing matched. Distinct from a rule that matched with no target: here
 * the rule stack had no opinion at all and the scenario catch-all decides.
 */
function NoMatch({ result }: { result: RuleTestResult }) {
  return (
    <div className='mt-3 rounded-md border border-border px-4 py-3'>
      <Pill tone='mute'>no rule matched</Pill>
      <div className='mt-2 text-[11px] text-muted-foreground'>
        All {result.evaluated.length} rules were evaluated and none applied. The lane&rsquo;s catch-all decides this
        request.
      </div>
      <TokenLine count={result.tokenCount} />
    </div>
  )
}

function Matched({ result }: { result: RuleTestResult }) {
  const position = (result.matchedIndex === null ? 0 : result.matchedIndex) + 1
  const last = position + result.notEvaluated
  return (
    <div className='mt-3 rounded-md border border-border px-4 py-3'>
      <div className='flex items-center gap-2'>
        <Pill tone='ok'>{`rule ${position} matched`}</Pill>
        <span className='text-[11px] text-muted-foreground'>
          {result.matchedName === null ? `Rule ${position}` : result.matchedName}
        </span>
      </div>
      <div className='mt-2 flex items-center gap-1.5 font-mono text-[11px]'>
        <span className='text-muted-foreground'>requested</span>
        <i className='ri-arrow-right-line text-xs text-muted-foreground/50' />
        {/* A null target on a MATCHED rule is a deliberate "leave this
            traffic alone", not an unfinished rule. */}
        <span>{result.target === null ? 'no rewrite — caller model goes upstream' : result.target}</span>
      </div>
      {result.notEvaluated === 0 ? null : (
        <div className='mt-1 text-[11px] text-muted-foreground'>
          {result.notEvaluated === 1
            ? `rule ${last} not evaluated (first match wins)`
            : `rules ${position + 1}–${last} not evaluated (first match wins)`}
        </div>
      )}
      <TokenLine count={result.tokenCount} />
    </div>
  )
}

export function RuleTester({ rules }: { rules: readonly RouteRule[] }) {
  const [text, setText] = useState(SAMPLE)
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback(() => {
    const parsed = parse(text)
    if (!parsed.ok) {
      setError('That is not a valid JSON object.')
      setResult(null)
      return
    }
    setRunning(true)
    setError(null)
    api
      .post<RuleTestResult>('/routing-rules/test', { rules, request: parsed.body })
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setResult(null)
      })
      .finally(() => setRunning(false))
  }, [text, rules])

  return (
    <div className='mt-6 border-t border-border px-6 py-5'>
      <div className='flex items-baseline gap-3'>
        <h3 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Test</h3>
        <span className='text-[11px] text-muted-foreground'>
          the router&rsquo;s own predicate code, over the real token count
        </span>
      </div>
      <div className='mt-3 flex items-center gap-2'>
        <input
          className='flex h-8 flex-1 items-center rounded-md border border-border bg-transparent px-3 font-mono text-xs text-muted-foreground outline-none'
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label='Request body'
        />
        <RButton variant='primary' icon='ri-play-line' onClick={run} disabled={running}>
          Run
        </RButton>
      </div>
      {error === null ? null : <div className='mt-3 text-[11px] text-destructive'>{error}</div>}
      {result === null ? null : (
        <>
          {result.matchedIndex === null ? <NoMatch result={result} /> : <Matched result={result} />}
          <Trace result={result} />
        </>
      )}
    </div>
  )
}
