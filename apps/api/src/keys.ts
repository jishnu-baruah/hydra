// Stateless API keys: "hyd_<claims>.<hmac>". Verifying is one HMAC; nothing is stored. Keys expire
// after 30 days. Revoking a single key early is not possible; rotating HYDRA_KEY_SECRET revokes all.

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface KeyClaims {
  address: string // checksummed wallet address that signed in
  app: string
  iat: number // ms
  exp: number // ms; keys stop working after this
}

export const KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest()

export function issueKey(secret: string, claims: KeyClaims): string {
  const body = b64(JSON.stringify(claims))
  return `hyd_${body}.${b64(mac(secret, body))}`
}

export function verifyKey(secret: string, key: string | undefined, now = Date.now()): KeyClaims | null {
  const m = /^hyd_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key ?? '')
  if (!m) return null
  const want = mac(secret, m[1])
  const got = Buffer.from(m[2], 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const c = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    if (typeof c.address !== 'string' || typeof c.app !== 'string' || typeof c.iat !== 'number') return null
    if (typeof c.exp !== 'number' || c.exp <= now) return null
    return { address: c.address, app: c.app, iat: c.iat, exp: c.exp }
  } catch {
    return null
  }
}
