// Wallet sign-in: the site asks for the exact message, the wallet signs it, and a valid signature
// within 10 minutes of its timestamp earns an API key bound to that address and app name.

import { getAddress, isAddress, isHex, verifyMessage } from 'viem'
import { issueKey, KEY_TTL_MS } from './keys.ts'

export const APP_NAME = /^[a-z0-9][a-z0-9-]{1,39}$/
const MAX_SKEW_MS = 10 * 60 * 1000

export function signInMessage(address: string, app: string, issuedAt: string): string {
  return (
    'Hydra wants you to sign in with your Ethereum account:\n' +
    `${address}\n\n` +
    `Create an API key for app "${app}". Builds published with it are recorded on Arkiv under this address.\n\n` +
    `Issued At: ${issuedAt}`
  )
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

export function checkInput(address: unknown, app: unknown): Result<{ address: string; app: string }> {
  if (typeof address !== 'string' || !isAddress(address)) {
    return { ok: false, status: 400, error: 'address must be an Ethereum address' }
  }
  if (typeof app !== 'string' || !APP_NAME.test(app)) {
    return { ok: false, status: 400, error: 'app must be 2 to 40 characters: lowercase letters, digits and dashes' }
  }
  return { ok: true, value: { address: getAddress(address), app } }
}

export async function keyFromSignature(
  secret: string,
  body: { address?: unknown; app?: unknown; issuedAt?: unknown; signature?: unknown },
  now = Date.now(),
): Promise<Result<{ apiKey: string; address: string; app: string }>> {
  const input = checkInput(body.address, body.app)
  if (!input.ok) return input
  const { address, app } = input.value
  const at = typeof body.issuedAt === 'string' ? Date.parse(body.issuedAt) : NaN
  if (!Number.isFinite(at) || Math.abs(now - at) > MAX_SKEW_MS) {
    return { ok: false, status: 400, error: 'issuedAt is missing or more than 10 minutes off; request a new message' }
  }
  if (typeof body.signature !== 'string' || !isHex(body.signature)) {
    return { ok: false, status: 400, error: 'signature must be a hex string' }
  }
  const message = signInMessage(address, app, body.issuedAt as string)
  const valid = await verifyMessage({ address, message, signature: body.signature }).catch(() => false)
  if (!valid) return { ok: false, status: 401, error: 'signature does not match this address and message' }
  return { ok: true, value: { apiKey: issueKey(secret, { address, app, iat: now, exp: now + KEY_TTL_MS }), address, app } }
}
