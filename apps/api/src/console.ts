// Console sessions: a wallet signs a short message (no gas), the API answers a stateless token
// "hys_<claims>.<hmac>". Same server secret as API keys, but a different prefix and a domain-separated
// MAC, so a key can never pass as a session or the reverse. Sessions last 2 hours.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getAddress, isHex, verifyMessage } from 'viem'
import type { Result } from './auth.ts'

export interface SessionClaims {
  address: string // checksummed
  scope: 'console'
  iat: number // ms
  exp: number // ms
}

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000
const MAX_AGE_MS = 10 * 60 * 1000
const MAX_AHEAD_MS = 60 * 1000
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/

// Named in the message so a wallet user can see when a phishing page is asking for it.
export const CONSOLE_URL = 'https://hydra-registry.vercel.app/console/'

export const consoleMessage = (address: string, issuedAt: string) =>
  `Hydra console sign-in\nOnly sign this on ${CONSOLE_URL}\nAddress: ${address.toLowerCase()}\nIssued: ${issuedAt}`

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`hydra-console-session\n${body}`).digest()

export function issueSession(secret: string, claims: SessionClaims): string {
  const body = b64(JSON.stringify(claims))
  return `hys_${body}.${b64(mac(secret, body))}`
}

export function verifySession(secret: string, token: string | undefined, now = Date.now()): SessionClaims | null {
  const m = /^hys_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token ?? '')
  if (!m) return null
  const want = mac(secret, m[1])
  const got = Buffer.from(m[2], 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const c = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    if (c.scope !== 'console' || typeof c.address !== 'string' || typeof c.iat !== 'number') return null
    if (typeof c.exp !== 'number' || c.exp <= now) return null
    return { address: c.address, scope: 'console', iat: c.iat, exp: c.exp }
  } catch {
    return null
  }
}

export async function sessionFromSignature(
  secret: string,
  body: { address?: unknown; issuedAt?: unknown; signature?: unknown },
  now = Date.now(),
): Promise<Result<{ session: string; address: string; expires: number }>> {
  if (typeof body.address !== 'string' || !ADDRESS.test(body.address)) {
    return { ok: false, status: 400, error: 'address must be 0x followed by 40 hex characters' }
  }
  const address = getAddress(body.address.toLowerCase())
  // Only the exact ISO string our message endpoint hands out is accepted, so the signed text has one spelling.
  const at = typeof body.issuedAt === 'string' ? Date.parse(body.issuedAt) : NaN
  if (!Number.isFinite(at) || new Date(at).toISOString() !== body.issuedAt || now - at > MAX_AGE_MS || at - now > MAX_AHEAD_MS) {
    return { ok: false, status: 400, error: 'issuedAt is missing, malformed, or not within the last 10 minutes; request a new message and sign it again' }
  }
  if (typeof body.signature !== 'string' || !isHex(body.signature)) {
    return { ok: false, status: 400, error: 'signature must be a hex string' }
  }
  const valid = await verifyMessage({ address, message: consoleMessage(address, body.issuedAt as string), signature: body.signature }).catch(() => false)
  if (!valid) return { ok: false, status: 401, error: 'signature does not match this address and message; sign the exact message from /v1/console/message with the same wallet' }
  const expires = now + SESSION_TTL_MS
  return { ok: true, value: { session: issueSession(secret, { address, scope: 'console', iat: now, exp: expires }), address, expires } }
}
