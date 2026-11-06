// Domain proof: a team binds a domain to its Hydra app by serving PROOF_PATH with the line
// `hydra-app=<app>`. The publish API checks it before a release lists the domain, and the indexer
// rechecks it every run. The file is fetched from a domain the client names, so only public
// hostnames that resolve to public addresses are fetched, without redirects, and the body is
// only compared, never parsed or run.

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const PROOF_PATH = '/.well-known/hydra.txt'
const MAX_PROOF = 4096
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const LOCAL = /\.(local|localhost|internal|lan|home|arpa)$/

export function normalizeDomain(d: unknown): string | null {
  if (typeof d !== 'string') return null
  const h = d.trim().toLowerCase().replace(/\.$/, '')
  if (h.length > 253 || isIP(h) || LOCAL.test(h)) return null
  const labels = h.split('.')
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels.at(-1)!)) return null
  return h
}

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) return isPrivateAddress(mapped[1])
  if (/^::ffff:/i.test(ip)) return true // hex-form mapped address: refuse rather than decode
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const x = ip.toLowerCase()
  return isIP(ip) !== 6 || x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x)
}

export const proofNames = (text: string, app: string): boolean =>
  text.split(/\r?\n/).some((line) => line.trim() === `hydra-app=${app}`)

export interface ProofDeps {
  lookup?: (host: string) => Promise<{ address: string; family: number }[]>
  fetch?: typeof fetch
}

export type ProofResult = { ok: true } | { ok: false; reason: string }

// Never throws: every failure comes back as a reason that names the fix.
export async function checkProof(domain: string, app: string, deps: ProofDeps = {}): Promise<ProofResult> {
  const host = normalizeDomain(domain)
  if (!host) return { ok: false, reason: `${String(domain).slice(0, 80)} is not a public hostname; list a domain such as app.example.com` }
  const fix = `serve https://${host}${PROOF_PATH} with the line hydra-app=${app}`
  try {
    const addrs = await (deps.lookup ?? ((h) => dnsLookup(h, { all: true })))(host)
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
      return { ok: false, reason: `${host} resolves to a private address or none; point it at your public site` }
    }
    const res = await (deps.fetch ?? fetch)(`https://${host}${PROOF_PATH}`, { redirect: 'error', signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} for ${PROOF_PATH}; ${fix}` }
    const body = await res.text()
    if (body.length > MAX_PROOF) return { ok: false, reason: `${PROOF_PATH} is over ${MAX_PROOF} bytes; ${fix}` }
    return proofNames(body, app) ? { ok: true } : { ok: false, reason: `${PROOF_PATH} does not contain the line hydra-app=${app}; ${fix}` }
  } catch (err) {
    return { ok: false, reason: `could not read ${PROOF_PATH} (${err instanceof Error ? err.message : String(err)}); ${fix}` }
  }
}
