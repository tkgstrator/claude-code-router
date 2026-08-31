/**
 * The SubAccount token encryption key.
 *
 * The variable was renamed in the Rialto rename, and the old name has to
 * keep working: every SubAccount row already on disk was encrypted under
 * whatever CCR_ACCOUNT_ENCRYPTION_KEY held. Ignoring it would not fail
 * loudly — the server would boot and every stored token would decrypt to
 * null, which reads as "the account needs re-authentication".
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { encryptionKey } from '../../../src/services/subscription-account-sync/crypto'

const HEX_A = 'ab'.repeat(32)
const HEX_B = 'cd'.repeat(32)

afterEach(() => {
  delete process.env.RIALTO_ACCOUNT_ENCRYPTION_KEY
  delete process.env.CCR_ACCOUNT_ENCRYPTION_KEY
})

describe('encryptionKey', () => {
  test('reads RIALTO_ACCOUNT_ENCRYPTION_KEY', () => {
    process.env.RIALTO_ACCOUNT_ENCRYPTION_KEY = HEX_A
    expect(encryptionKey().toString('hex')).toBe(HEX_A)
  })

  test('falls back to the pre-rename CCR_ACCOUNT_ENCRYPTION_KEY', () => {
    process.env.CCR_ACCOUNT_ENCRYPTION_KEY = HEX_A
    expect(encryptionKey().toString('hex')).toBe(HEX_A)
  })

  test('prefers the new name when both are set', () => {
    process.env.RIALTO_ACCOUNT_ENCRYPTION_KEY = HEX_A
    process.env.CCR_ACCOUNT_ENCRYPTION_KEY = HEX_B
    expect(encryptionKey().toString('hex')).toBe(HEX_A)
  })

  test('throws under the new name when neither is set', () => {
    expect(() => encryptionKey()).toThrow('RIALTO_ACCOUNT_ENCRYPTION_KEY')
  })
})
