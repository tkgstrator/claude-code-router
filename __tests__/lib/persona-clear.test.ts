import { expect, test } from 'bun:test'
import { splitPayload } from '../../src/services/config/apply'

const PERSONA_ID = 'b3f1c0a2-1d4e-4a7b-9c2f-1a2b3c4d5e6f'

// The active persona is envelope-bound (disk key `ActivePersona`), not a
// DB column, so splitPayload lifts it off Router. It distinguishes
// "clear the persona" from "this save didn't touch the persona" purely
// by whether the key is present — which is why the value the UI sends
// must be null and never undefined.

test('an explicit null clears the active persona', () => {
  const { envelope } = splitPayload({ Router: { persona: null } })
  expect('ActivePersona' in envelope).toBe(true)
  expect(envelope.ActivePersona).toBe(null)
})

test('an empty string clears it too', () => {
  const { envelope } = splitPayload({ Router: { persona: '' } })
  expect(envelope.ActivePersona).toBe(null)
})

test('a router save that omits persona leaves the selection alone', () => {
  // Partial saves from other pages post Router without a persona key;
  // wiping the selection on those would be the mirror-image bug.
  const { envelope } = splitPayload({ Router: {} })
  expect('ActivePersona' in envelope).toBe(false)
})

test('a persona id is lifted onto the envelope', () => {
  const { envelope } = splitPayload({ Router: { persona: PERSONA_ID } })
  expect(envelope.ActivePersona).toBe(PERSONA_ID)
})

test('persona never reaches the DB-bound router slice', () => {
  const { incomingRouter } = splitPayload({ Router: { persona: PERSONA_ID } })
  expect(incomingRouter).not.toBeUndefined()
  expect('persona' in (incomingRouter as Record<string, unknown>)).toBe(false)
})

test('undefined is indistinguishable from absent — the shape the UI must not send', () => {
  // Documents the regression: JSON.stringify drops an undefined value, so
  // a cleared persona sent as undefined arrives as an omitted key and the
  // old selection survives the save.
  const overTheWire = JSON.parse(JSON.stringify({ Router: { persona: undefined } }))
  const { envelope } = splitPayload(overTheWire)
  expect('ActivePersona' in envelope).toBe(false)
})
