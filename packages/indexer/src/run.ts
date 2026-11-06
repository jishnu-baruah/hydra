// One indexer pass: fetch each target's page, hash the scripts it loads, compare them with the
// app's latest Hydra release, and write 1 observation per target to Arkiv (3-day expiry, so
// "checked recently" is "an observation exists"). Only changed sites are written (plus a daily heartbeat). Used by the CLI (main.ts) and by the API's
// POST /v1/indexer/run, which a scheduled GitHub Actions job calls.

import { readFile } from 'node:fs/promises'
import {
  OBSERVATION_TTL,
  checkProof,
  safeGet,
  ObservationSchema,
  arkivClients,
  guardedBatch,
  observationValues,
  rootCause,
  recentObservations,
  type CreateSpec,
} from '@hydra/core'
import { hexToString, type Hex } from 'viem'
import { shouldWrite, topTargets } from './coverage.ts'
import { bindTargets, compare, proofProblem, runtimeProblems, scriptUrls, scriptHash, scriptsHash, type BoundTarget, type Manifest, type Seen } from './scan.ts'

const MAX_SCRIPTS = 60
const MAX_BYTES = 5 * 1024 * 1024
const BATCH = 10 // observations per transaction; 20 targets is 2 transactions

type Target = BoundTarget

// Pages and scripts come from domains a publisher chose, so they are fetched only from public
// addresses, https only, pinned, with each redirect rechecked (safeGet in @hydra/core).
const get = (url: string, timeoutMs = 15_000): Promise<Uint8Array> => safeGet(url, { maxBytes: MAX_BYTES, timeoutMs })

// The page as a browser renders it, from Jina's network (needs JINA_KEY). null when there is no
// key, the call fails, or the result has no scripts (a bot challenge page, e.g. balancer.fi).
async function rendered(pageUrl: string): Promise<string | null> {
  const key = process.env.JINA_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://r.jina.ai/${pageUrl}`, {
      headers: { Authorization: `Bearer ${key}`, 'X-Return-Format': 'html' },
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return null
    const html = await res.text()
    return scriptUrls(html, pageUrl).length ? html : null
  } catch {
    return null
  }
}

// The newest release's manifest for a Hydra app, read through the API's trust-filtered route.
async function manifestFor(api: string, app: string): Promise<Manifest | null> {
  try {
    const res = await fetch(`${api}/v1/apps/${encodeURIComponent(app)}/releases`, { signal: AbortSignal.timeout(60_000) })
    const { releases } = (await res.json()) as { releases?: { payload?: { manifest?: Manifest } }[] }
    return releases?.[0]?.payload?.manifest ?? null
  } catch {
    return null
  }
}

// /v1/activity returns the newest 100 releases, so apps with only older ones are missed (T-A20).
const ACTIVITY_LIMIT = 100

// Every app with a release on the API, with its latest manifest. Throws with the cause on failure.
async function discover(api: string, warn: string[]): Promise<{ app: string; manifest: Manifest }[]> {
  const res = await fetch(`${api}/v1/activity`, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { events } = (await res.json()) as { events?: { kind?: string; app?: string }[] }
  const rel = (events ?? []).filter((e) => e.kind === 'release' && typeof e.app === 'string')
  if (rel.length >= ACTIVITY_LIMIT) warn.push(`release discovery saw ${rel.length} releases, the activity limit; apps with only older releases may be unbound`)
  const apps = [...new Set(rel.map((e) => e.app as string))]
  const found = await Promise.all(apps.map(async (app) => ({ app, manifest: await manifestFor(api, app) })))
  return found.filter((f): f is { app: string; manifest: Manifest } => !!f.manifest)
}

// The newest earlier observation of a domain, read back from Arkiv (the free host sleeps between
// runs, so nothing is kept in memory).
interface Prev {
  status: string
  scripts_hash: string
  problems: string[]
  observed_at: number
  runtime: string[]
}

const DAY = 86_400_000

async function scan(t: Target, prev: Prev | undefined, now: number) {
  const pageUrl = `https://${t.domain}/`
  let seen: Seen[] = []
  let problems: string[] = []
  let status: 'match' | 'mismatch' | 'unknown' = 'unknown'
  let via: 'direct' | 'renderer' = 'direct'
  let runtime: string[] = prev?.runtime ?? []
  let hash = scriptsHash(seen)
  // A bound domain is rechecked first. One that lost its proof, or now resolves to a private
  // address, is not fetched at all: it is a mismatch on the proof alone. An unreadable proof is
  // noted and the scan goes on.
  const proof = t.bound && t.app ? proofProblem(true, await checkProof(t.domain, t.app)) : null
  if (proof) problems.push(proof)
  const lost = proof?.startsWith('DOMAIN_PROOF_LOST')
  if (lost) status = 'mismatch'
  const manifest = t.manifest
  if (!lost) try {
    let html: string
    let r2: string | null = null
    try {
      html = new TextDecoder().decode(await get(pageUrl))
    } catch (err) {
      // Blocked or down for us: read the script list from the renderer, still hash scripts directly.
      r2 = await rendered(pageUrl)
      if (!r2) throw err
      html = r2
      via = 'renderer'
      problems.push(`DIRECT_BLOCKED ${rootCause(err)}`)
    }
    const urls = scriptUrls(html, pageUrl)
    if (urls.length > MAX_SCRIPTS) problems.push(`TRUNCATED ${urls.length} scripts, checked ${MAX_SCRIPTS}`)
    seen = await Promise.all(
      urls.slice(0, MAX_SCRIPTS).map(async (url) => ({ url, sha256: await get(url).then(scriptHash, () => null) })),
    )
    hash = scriptsHash(seen)
    const r = compare(pageUrl, seen, manifest)
    status = r.status
    problems = [...problems, ...r.problems]
    if (via === 'direct') {
      // Jina is rationed: only for a first sight, a stale (over 24 h) or changed site; else reuse the last origins.
      const need = !prev || now - prev.observed_at >= DAY || prev.scripts_hash !== hash
      r2 = need ? await rendered(pageUrl) : null
      const rendUrls = r2 ? scriptUrls(r2, pageUrl) : runtime
      if (r2 || runtime.length) {
        const rt = runtimeProblems({ pageUrl, raw: urls, rendered: rendUrls, manifest, previous: prev?.runtime })
        runtime = rt.origins
        problems.push(...rt.problems)
        if (rt.problems.length && status === 'match') status = 'mismatch'
      }
    }
  } catch (err) {
    problems.push(`UNREACHABLE ${rootCause(err)}`)
  }
  const changed = !!prev && prev.scripts_hash !== hash
  return { t, status, seen, problems, hash, changed, via, runtime }
}

// Runs f over items with at most n in flight, keeping order.
async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await f(items[i])
    }
  }))
  return out
}

export interface RunSummary {
  sites: number
  written: number
  skipped: number // unchanged since the last observation, so not written
  txs: string[]
  errors: string[]
  lines: string[] // notable sites plus one count line, for logs
  ms: number
}

const PREV_WINDOW = 3 * DAY
const LLAMA = 'https://api.llama.fi/protocols'

// Newest earlier observation per domain from the indexer wallet's own records.
async function previous(reader: unknown, addr: Hex, now: number): Promise<Map<string, Prev>> {
  const rows = await recentObservations(reader, addr, now - PREV_WINDOW)
  const out = new Map<string, Prev>() // rows come newest first
  for (const r of rows as Record<string, unknown>[]) {
    const domain = typeof r.domain === 'string' ? r.domain.toLowerCase() : ''
    if (!domain || out.has(domain)) continue
    let body: { problems?: unknown; runtime_origins?: unknown } = {}
    try {
      body = JSON.parse(hexToString(r.body as Hex))
    } catch {
      // an unreadable body still counts as a previous sighting
    }
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    out.set(domain, {
      status: String(r.status),
      scripts_hash: String(r.scripts_hash),
      problems: strs(body.problems),
      observed_at: Number(r.observed_at),
      runtime: strs(body.runtime_origins),
    })
  }
  return out
}

// `clients` without a wallet (or null) scans and reports but writes nothing. `indexerAddress` is for
// a dry run: with no wallet it names whose earlier observations to read (read-only).
export async function runOnce(o: { api: string; clients: ReturnType<typeof arkivClients> | null; indexerAddress?: Hex }): Promise<RunSummary> {
  const { targets: listed } = JSON.parse(await readFile(new URL('../targets.json', import.meta.url), 'utf8')) as { targets: { app?: string; domain: string; category: string }[] }
  const started = Date.now()
  const errors: string[] = []
  let releases: { app: string; manifest: Manifest }[] = []
  try {
    releases = await discover(o.api, errors)
  } catch (err) {
    errors.push(`release discovery failed, all targets unbound: ${rootCause(err)}. Check the API at ${o.api} and rerun`)
  }
  // Discovery: targets.json first, then the top N protocols by TVL from DefiLlama.
  let merged: { app?: string; domain: string; category: string }[] = listed
  try {
    const res = await fetch(LLAMA, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const apps = new Map(listed.map((e) => [e.domain.toLowerCase(), e.app]))
    merged = topTargets(await res.json(), Number(process.env.INDEXER_TOP ?? 227), listed).map((e) => ({ ...e, app: apps.get(e.domain.toLowerCase()) }))
  } catch (err) {
    errors.push(`DefiLlama discovery failed, scanning targets.json only: ${rootCause(err)}. Check ${LLAMA} and rerun`)
  }
  const category = new Map(merged.map((e) => [e.domain.toLowerCase(), e.category]))
  const targets = bindTargets(merged, releases)

  // Earlier observations come from Arkiv, not memory.
  const wallet = o.clients?.walletClient
  const addr = (wallet?.account.address ?? o.indexerAddress ?? process.env.HYDRA_INDEXER_ADDRESS) as Hex | undefined
  let prevs = new Map<string, Prev>()
  if (!addr) errors.push('no indexer address (no wallet and HYDRA_INDEXER_ADDRESS unset), so every site counts as first sight. Set HYDRA_INDEXER_ADDRESS and rerun')
  else
    try {
      const reader = o.clients?.publicClient ?? arkivClients({ accessKey: process.env.ARKIV_ACCESS_KEY }).publicClient
      prevs = await previous(reader, addr, started)
    } catch (err) {
      errors.push(`could not read earlier observations: ${rootCause(err)}. Every site counts as first sight this run; check ARKIV_ACCESS_KEY and the Arkiv RPC`)
    }

  const results = await pool(targets, Number(process.env.INDEXER_POOL ?? 8), (t) => scan(t, prevs.get(t.domain), started))
  const due = results.filter((r) => shouldWrite(prevs.get(r.t.domain) ?? null, { status: r.status, scripts_hash: r.hash, problems: r.problems }, started))
  const lines = results
    .filter((r) => r.status !== 'unknown' || r.problems.length || r.changed)
    .map((r) => {
      const note = [r.changed ? 'CHANGED SINCE LAST RUN' : '', r.runtime.length ? `runtime: ${r.runtime.join(' ')}` : '', ...r.problems.slice(0, 3)].filter(Boolean).join('; ')
      return `${r.status.padEnd(8)} ${r.t.domain.padEnd(28)} ${String(r.seen.length).padStart(3)} scripts ${note}`
    })
  const count = (st: string) => results.filter((r) => r.status === st).length
  lines.push(`${results.length} sites: ${count('match')} match, ${count('mismatch')} mismatch, ${count('unknown')} unknown; ${due.length} to write, ${results.length - due.length} unchanged`)
  const summary: RunSummary = { sites: results.length, written: 0, skipped: results.length - due.length, txs: [], errors, lines, ms: 0 }
  if (o.clients && wallet) {
    const specs: CreateSpec[] = due.map((r) => ({
      schema: ObservationSchema,
      values: observationValues({
        domain: r.t.domain,
        app: r.t.app,
        status: r.status,
        observedAt: started,
        scriptsHash: r.hash,
        payload: { scripts: r.seen.map((s) => ({ url: s.url, sha256: s.sha256 ?? 'unreadable' })), problems: r.problems, changed: r.changed, via: r.via, runtime_origins: r.runtime, category: category.get(r.t.domain) ?? 'other' } as never,
      }),
      expiration: OBSERVATION_TTL(),
    }))
    for (let i = 0; i < specs.length; i += BATCH) {
      // Guarded: one transaction, never resent. A failed batch is reported and the next run carries on.
      const chunk = specs.slice(i, i + BATCH)
      try {
        const { txHash } = await guardedBatch({ publicClient: o.clients.publicClient, walletClient: wallet, creates: chunk })
        summary.txs.push(txHash)
        summary.written += chunk.length
      } catch (err) {
        summary.errors.push(`batch ${i / BATCH + 1} not written: ${rootCause(err)}`)
      }
    }
  }
  summary.ms = Date.now() - started
  return summary
}
