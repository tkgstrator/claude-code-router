import { describe, expect, test } from 'bun:test'
import {
  type AccessCheckResponse,
  accessSaveGate,
  checkTone,
  normalizeAccessInput,
  sameAccessInput
} from '../../../../src/lib/rialto/settings/access-config'

const GOOD = { teamDomain: 'acme.cloudflareaccess.com', aud: 'abc123' }

const check = (over: Partial<AccessCheckResponse>): AccessCheckResponse => ({
  jwksReachable: true,
  keyCount: 2,
  assertionPresent: true,
  assertionValid: true,
  email: 'someone@example.com',
  detail: 'Verified.',
  ...over
})

describe('normalizeAccessInput', () => {
  test('strips a scheme the runtime would not strip', () => {
    // readAccessConfig removes only trailing slashes, so a saved
    // "https://…" makes the runtime fetch https://https://… and reject
    // every request. access-check strips it, so without this the check
    // would pass and the save would still lock the operator out.
    expect(normalizeAccessInput({ teamDomain: 'https://acme.cloudflareaccess.com', aud: 'x' }).teamDomain).toBe(
      'acme.cloudflareaccess.com'
    )
    expect(normalizeAccessInput({ teamDomain: 'http://acme.cloudflareaccess.com', aud: 'x' }).teamDomain).toBe(
      'acme.cloudflareaccess.com'
    )
  })

  test('strips trailing slashes and surrounding whitespace', () => {
    expect(normalizeAccessInput({ teamDomain: '  acme.cloudflareaccess.com//  ', aud: '  t  ' })).toEqual({
      teamDomain: 'acme.cloudflareaccess.com',
      aud: 't'
    })
  })

  test('leaves an already-clean value alone', () => {
    expect(normalizeAccessInput(GOOD)).toEqual(GOOD)
  })
})

describe('accessSaveGate', () => {
  test('clearing both fields needs no check — turning Access off cannot lock anyone out', () => {
    const gate = accessSaveGate({ teamDomain: '', aud: '' }, null, null)
    expect(gate.allowed).toBe(true)
    expect(gate.allowed && gate.caveat).toContain('turns Access off')
  })

  test('one field alone is refused, because it would silently protect nothing', () => {
    expect(accessSaveGate({ teamDomain: GOOD.teamDomain, aud: '' }, null, null).allowed).toBe(false)
    expect(accessSaveGate({ teamDomain: '', aud: GOOD.aud }, null, null).allowed).toBe(false)
  })

  test('a complete pair cannot be saved unchecked', () => {
    expect(accessSaveGate(GOOD, null, null).allowed).toBe(false)
  })

  test('a verdict for different input does not authorise this one', () => {
    // The obvious way a check-then-save flow gets defeated: check a good
    // domain, then edit the field and save on the stale pass.
    const stale = { teamDomain: 'other.cloudflareaccess.com', aud: 'abc123' }
    expect(accessSaveGate(GOOD, check({}), stale).allowed).toBe(false)
    expect(accessSaveGate(GOOD, check({}), { ...GOOD, aud: 'different' }).allowed).toBe(false)
  })

  test('an unreachable JWKS is refused and reports the server detail verbatim', () => {
    const res = check({ jwksReachable: false, assertionPresent: false, assertionValid: null, detail: 'No keys at x.' })
    const gate = accessSaveGate(GOOD, res, GOOD)
    expect(gate.allowed).toBe(false)
    expect(gate.allowed === false && gate.reason).toBe('No keys at x.')
  })

  test('our own assertion failing is refused — saving would lock us out', () => {
    const res = check({ assertionValid: false, detail: 'Does NOT verify.' })
    const gate = accessSaveGate(GOOD, res, GOOD)
    expect(gate.allowed).toBe(false)
    expect(gate.allowed === false && gate.reason).toBe('Does NOT verify.')
  })

  test('no assertion on this request allows the save but keeps the caveat', () => {
    const res = check({ assertionPresent: false, assertionValid: null, detail: 'AUD not checked.' })
    const gate = accessSaveGate(GOOD, res, GOOD)
    expect(gate.allowed).toBe(true)
    expect(gate.allowed && gate.caveat).toBe('AUD not checked.')
  })

  test('a fully verified check allows the save with no caveat', () => {
    const gate = accessSaveGate(GOOD, check({}), GOOD)
    expect(gate).toEqual({ allowed: true, caveat: null })
  })
})

describe('checkTone', () => {
  test('mirrors the gate so the badge cannot contradict the button', () => {
    expect(checkTone(check({ jwksReachable: false }))).toBe('bad')
    expect(checkTone(check({ assertionValid: false }))).toBe('bad')
    expect(checkTone(check({ assertionPresent: false, assertionValid: null }))).toBe('warn')
    expect(checkTone(check({}))).toBe('ok')
  })
})

describe('sameAccessInput', () => {
  test('compares both halves', () => {
    expect(sameAccessInput(GOOD, { ...GOOD })).toBe(true)
    expect(sameAccessInput(GOOD, { ...GOOD, aud: 'z' })).toBe(false)
    expect(sameAccessInput(GOOD, { ...GOOD, teamDomain: 'z' })).toBe(false)
  })
})
