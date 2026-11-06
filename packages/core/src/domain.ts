// Domain proof: a team binds a domain to its Hydra app by serving PROOF_PATH with the line
// `hydra-app=<app>`. The publish API checks it before a release lists the domain, and the indexer
// rechecks it every run. The file is fetched from a domain the client names, so only public
// hostnames that resolve to public addresses are fetched, without redirects, and the body is
// only compared, never parsed or run.

import { lookup as dnsLookup } from 'node:dns/promises'
import { request } from 'node:https'
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

// IPv6 counts as public only inside global unicast (2000::/3), minus documentation (2001:db8::/32)
// and 6to4 (2002::/16, which can wrap a private IPv4). The URL parser puts any spelling in one form.
export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) return isPrivateAddress(mapped[1])
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (isIP(ip) !== 6) return true
  const x = new URL(`http://[${ip}]`).hostname.slice(1, -1)
  const first = parseInt(x.split(':')[0] || '0', 16)
  return first < 0x2000 || first > 0x3fff || first === 0x2002 || x.startsWith('2001:db8:')
}

export const proofNames = (text: string, app: string): boolean =>
  text.split(/\r?\n/).some((line) => line.trim() === `hydra-app=${app}`)

type Addr = { address: string; family: number }

export interface ProofDeps {
  lookup?: (host: string) => Promise<Addr[]>
  // GET https://<host><path> connected to `addr` only. body is null when over MAX_PROOF bytes.
  get?: (host: string, addr: Addr, path: string) => Promise<{ status: number; body: string | null }>
}

// transient: the file could not be read (network, timeout, 5xx), which says nothing about a hijack.
export type ProofResult = { ok: true } | { ok: false; reason: string; transient?: true }

// The connection goes to the address we checked (no second DNS answer), never follows a redirect,
// and stops reading past MAX_PROOF bytes.
function pinnedGet(host: string, addr: Addr, path: string): Promise<{ status: number; body: string | null }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host, path, servername: host, agent: false, timeout: 5_000, headers: { 'User-Agent': 'HydraProof/0.1' },
        lookup: (_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o?.all ? cb(null, [addr]) : cb(null, addr.address, addr.family),
      } as never,
      (res) => {
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_PROOF) return res.destroy(), resolve({ status: res.statusCode ?? 0, body: null })
          chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timed out after 5 s')))
    req.on('error', reject)
    req.end()
  })
}

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
    const { status, body } = await (deps.get ?? pinnedGet)(host, addrs[0], PROOF_PATH)
    if (status >= 500) return { ok: false, transient: true, reason: `HTTP ${status} for ${PROOF_PATH}, the site may be down; ${fix}` }
    if (status !== 200) return { ok: false, reason: `HTTP ${status} for ${PROOF_PATH}; ${fix}` }
    if (body === null) return { ok: false, reason: `${PROOF_PATH} is over ${MAX_PROOF} bytes; ${fix}` }
    return proofNames(body, app) ? { ok: true } : { ok: false, reason: `${PROOF_PATH} does not contain the line hydra-app=${app}; ${fix}` }
  } catch (err) {
    return { ok: false, transient: true, reason: `could not read ${PROOF_PATH} (${err instanceof Error ? err.message : String(err)}); ${fix}` }
  }
}
