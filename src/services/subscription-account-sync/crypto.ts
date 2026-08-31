/**
 * Small string helpers plus the AES-256-GCM encrypt/decrypt primitives
 * used to persist and read back SubAccount token material.
 *
 * JWT claim decoding used to live here too; it is vendor-specific rather
 * than storage-level and now sits in ../codex-auth/claims.ts.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// `firstString(...candidates)` is the project's `??`-free idiom for
// "first non-empty string, else null".
export const firstString = (...vs: Array<unknown>): string | null => {
  for (const v of vs) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

export const encryptionKey = (): Buffer => {
  const envValue = process.env.CCR_ACCOUNT_ENCRYPTION_KEY
  const raw = typeof envValue === 'string' ? envValue.trim() : ''
  if (!raw) {
    throw new Error('CCR_ACCOUNT_ENCRYPTION_KEY is required for SubAccount token encryption')
  }
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  try {
    const b = Buffer.from(raw, 'base64')
    if (b.length === 32) return b
  } catch {
    // ignore
  }
  return createHash('sha256').update(raw).digest()
}

export const encryptString = (plain: string | null, key: Buffer): string | null => {
  if (!plain) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

export const decryptString = (enc: string | null, key: Buffer): string | null => {
  if (!enc) return null
  const parts = enc.split('.')
  if (parts.length !== 3) return null
  try {
    const iv = Buffer.from(parts[0], 'base64')
    const tag = Buffer.from(parts[1], 'base64')
    const body = Buffer.from(parts[2], 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
