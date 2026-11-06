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

export type RawGet = (host: string, addr: Addr, path: string, maxBytes: number, timeoutMs: number) =>
  Promise<{ status: number; location?: string; body: Buffer | null }>

export interface RawRequestInit {
  method: string
  path: string
  headers: Record<string, string>
  body?: string
  maxBytes: number
  timeoutMs: number
}
export type RawRequest = (host: string, addr: Addr, r: RawRequestInit) =>
  Promise<{ status: number; location?: string; body: Buffer | null }>

const UA = 'HydraIndexer/0.1 (+https://hydra-site-one.vercel.app)'

// The connection goes to the address we checked (no second DNS answer), never follows a redirect,
// and stops reading past maxBytes (body null). No Accept-Encoding, so the bytes are the file itself.
const pinnedRequest: RawRequest = (host, addr, r) =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host, path: r.path, method: r.method, servername: host, agent: false, timeout: r.timeoutMs,
        headers: { 'User-Agent': UA, ...r.headers, ...(r.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(r.body)) } : {}) },
        lookup: (_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o?.all ? cb(null, [addr]) : cb(null, addr.address, addr.family),
      } as never,
      (res) => {
        const status = res.statusCode ?? 0
        const location = typeof res.headers.location === 'string' ? res.headers.location : undefined
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > r.maxBytes) return res.destroy(), resolve({ status, location, body: null })
          chunks.push(c)
        })
        res.on('end', () => resolve({ status, location, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    const timer = setTimeout(() => req.destroy(new Error(`timed out after ${r.timeoutMs / 1000} s`)), r.timeoutMs)
    req.on('close', () => clearTimeout(timer))
    req.on('timeout', () => req.destroy(new Error(`timed out after ${r.timeoutMs / 1000} s`)))
    req.on('error', reject)
    req.end(r.body)
  })

const pinnedGet: RawGet = (host, addr, path, maxBytes, timeoutMs) => pinnedRequest(host, addr, { method: 'GET', path, headers: {}, maxBytes, timeoutMs })

const defaultLookup = (h: string) => dnsLookup(h, { all: true })

// https on the default port, no credentials, hostname not an IP literal, every resolved address
// public. Returns the address to pin the connection to. `shown` is what errors may name: safePost
// passes null, because its URLs carry secrets.
async function publicTarget(url: string, lookup: ProofDeps['lookup'], shown: string | null): Promise<{ u: URL; host: string; addr: Addr }> {
  let u: URL | null = null
  try {
    u = new URL(url)
  } catch {
    // not a URL at all
  }
  const host = u && u.protocol === 'https:' && !u.port && !u.username && !u.password ? normalizeDomain(u.hostname) : null
  if (!u || !host) throw new Error(`${shown === null ? 'the target' : shown} is not a public https URL on the default port`)
  const addrs = await (lookup ?? defaultLookup)(host).catch((err) => {
    if (shown !== null) throw err
    const code = (err as { code?: unknown })?.code
    throw new Error(`the target host did not resolve (${typeof code === 'string' && /^[A-Z_0-9]+$/.test(code) ? code : 'DNS error'})`)
  })
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${shown === null ? 'the target host' : host} resolves to a private address or none`)
  }
  return { u, host, addr: addrs[0] }
}

// GET a URL that a publisher's site chose (its page, its scripts). https on the default port only,
// hostname not an IP literal, every resolved address public, the connection pinned to it, each
// redirect hop checked the same way (at most 3), body capped. Throws an Error naming the cause.
export async function safeGet(
  url: string,
  o: { maxBytes: number; timeoutMs?: number },
  deps: { lookup?: ProofDeps['lookup']; get?: RawGet } = {},
): Promise<Uint8Array> {
  let next = url
  for (let hop = 0; hop <= 3; hop++) {
    const { u, host, addr } = await publicTarget(next, deps.lookup, next.slice(0, 120))
    const r = await (deps.get ?? pinnedGet)(host, addr, `${u.pathname}${u.search}`, o.maxBytes, o.timeoutMs ?? 15_000)
    if (r.status >= 300 && r.status < 400 && r.location) {
      next = new URL(r.location, u).href
      continue
    }
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
    if (r.body === null) throw new Error(`over ${o.maxBytes} bytes`)
    return new Uint8Array(r.body)
  }
  throw new Error('more than 3 redirects')
}

// POST to a URL a team chose (an alert webhook). The same address rules as safeGet, but a redirect
// is never followed (the caller sees the 3xx), at most maxBytes of the answer are read, and errors
// never name the URL, host or address, since webhook URLs are secrets. Throws an Error naming the cause.
export async function safePost(
  url: string,
  body: string,
  headers: Record<string, string>,
  o: { timeoutMs?: number; maxBytes?: number; lookup?: ProofDeps['lookup']; request?: RawRequest } = {},
): Promise<{ status: number }> {
  const { u, host, addr } = await publicTarget(url, o.lookup, null)
  const timeoutMs = o.timeoutMs ?? 10_000
  try {
    const r = await (o.request ?? pinnedRequest)(host, addr, { method: 'POST', path: `${u.pathname}${u.search}`, headers, body, maxBytes: o.maxBytes ?? 64 * 1024, timeoutMs })
    return { status: r.status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/^timed out/.test(msg)) throw new Error(`the request timed out after ${timeoutMs / 1000} s`)
    const code = (err as { code?: unknown })?.code
    throw new Error(`the request failed (${typeof code === 'string' && /^[A-Z_0-9]+$/.test(code) ? code : 'network error'})`)
  }
}

// Never throws: every failure comes back as a reason that names the fix.
export async function checkProof(domain: string, app: string, deps: ProofDeps = {}): Promise<ProofResult> {
  const host = normalizeDomain(domain)
  if (!host) return { ok: false, reason: `${String(domain).slice(0, 80)} is not a public hostname; list a domain such as app.example.com` }
  const fix = `serve https://${host}${PROOF_PATH} with the line hydra-app=${app}`
  try {
    const addrs = await (deps.lookup ?? defaultLookup)(host)
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
      return { ok: false, reason: `${host} resolves to a private address or none; point it at your public site` }
    }
    const { status, body } = await (deps.get ?? ((h, a, p) =>
      pinnedGet(h, a, p, MAX_PROOF, 5_000).then((r) => ({ status: r.status, body: r.body && r.body.toString('utf8') }))))(host, addrs[0], PROOF_PATH)
    if (status >= 500) return { ok: false, transient: true, reason: `HTTP ${status} for ${PROOF_PATH}, the site may be down; ${fix}` }
    if (status >= 300 && status < 400) return { ok: false, reason: `HTTP ${status} for ${PROOF_PATH}: redirects are not followed; ${fix} directly` }
    if (status !== 200) return { ok: false, reason: `HTTP ${status} for ${PROOF_PATH}; ${fix}` }
    if (body === null) return { ok: false, reason: `${PROOF_PATH} is over ${MAX_PROOF} bytes; ${fix}` }
    return proofNames(body, app) ? { ok: true } : { ok: false, reason: `${PROOF_PATH} does not contain the line hydra-app=${app}; ${fix}` }
  } catch (err) {
    return { ok: false, transient: true, reason: `could not read ${PROOF_PATH} (${err instanceof Error ? err.message : String(err)}); ${fix}` }
  }
}
