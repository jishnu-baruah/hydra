// Stateless API keys: "hyd_<claims>.<hmac>". Verifying is one HMAC; nothing is stored. Revoking a
// single key is not possible; rotating HYDRA_KEY_SECRET revokes them all.

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface KeyClaims {
  address: string // checksummed wallet address that signed in
  app: string
  iat: number // ms
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest()

export function issueKey(secret: string, claims: KeyClaims): string {
  const body = b64(JSON.stringify(claims))
  return `hyd_${body}.${b64(mac(secret, body))}`
}

export function verifyKey(secret: string, key: string | undefined): KeyClaims | null {
  const m = /^hyd_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key ?? '')
  if (!m) return null
  const want = mac(secret, m[1])
  const got = Buffer.from(m[2], 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const c = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    if (typeof c.address !== 'string' || typeof c.app !== 'string' || typeof c.iat !== 'number') return null
    return { address: c.address, app: c.app, iat: c.iat }
  } catch {
    return null
  }
}
