// One indexer pass: fetch each target's page, hash the scripts it loads, compare them with the
// app's latest Hydra release, and write 1 observation per target to Arkiv (3-day expiry, so
// "checked recently" is "an observation exists"). Used by the CLI (main.ts) and by the API's
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
  type CreateSpec,
} from '@hydra/core'
import { bindTargets, compare, proofProblem, runtimeProblems, scriptUrls, scriptsHash, sha256Tag, type BoundTarget, type Manifest, type Seen } from './scan.ts'

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

// Previous scripts_hash per domain, for "changed since last run". In memory: a restart (or a free
// Render service waking up) forgets it, so the first run after one reports no changes.
const last = new Map<string, string>()
const lastRuntime = new Map<string, string[]>() // domain -> runtime-only origins from the previous run

async function scan(t: Target) {
  const pageUrl = `https://${t.domain}/`
  let seen: Seen[] = []
  let problems: string[] = []
  let status: 'match' | 'mismatch' | 'unknown' = 'unknown'
  let via: 'direct' | 'renderer' = 'direct'
  let runtime: string[] = []
  // A bound domain is rechecked first. One that lost its proof, or now resolves to a private
  // address, is not fetched at all: it is a mismatch on the proof alone. An unreadable proof is
  // noted and the scan goes on.
  const proof = t.bound && t.app ? proofProblem(true, await checkProof(t.domain, t.app)) : null
  if (proof) problems.push(proof)
  const lost = proof?.startsWith('DOMAIN_PROOF_LOST')
  if (lost) status = 'mismatch'
  const renderedP = lost ? Promise.resolve(null) : rendered(pageUrl) // in parallel with the direct fetch
  const manifest = t.manifest
  if (!lost) try {
    let html: string
    try {
      html = new TextDecoder().decode(await get(pageUrl))
    } catch (err) {
      // Blocked or down for us: read the script list from the renderer, still hash scripts directly.
      const r = await renderedP
      if (!r) throw err
      html = r
      via = 'renderer'
      problems.push(`DIRECT_BLOCKED ${rootCause(err)}`)
    }
    const urls = scriptUrls(html, pageUrl)
    if (urls.length > MAX_SCRIPTS) problems.push(`TRUNCATED ${urls.length} scripts, checked ${MAX_SCRIPTS}`)
    seen = await Promise.all(
      urls.slice(0, MAX_SCRIPTS).map(async (url) => ({ url, sha256: await get(url).then(sha256Tag, () => null) })),
    )
    const r = compare(pageUrl, seen, manifest)
    status = r.status
    problems = [...problems, ...r.problems]
    const r2 = via === 'direct' ? await renderedP : null
    if (r2) {
      const rt = runtimeProblems({ pageUrl, raw: urls, rendered: scriptUrls(r2, pageUrl), manifest, previous: lastRuntime.get(t.domain) })
      runtime = rt.origins
      lastRuntime.set(t.domain, rt.origins)
      problems.push(...rt.problems)
      if (rt.problems.length && status === 'match') status = 'mismatch'
    }
  } catch (err) {
    problems.push(`UNREACHABLE ${rootCause(err)}`)
  }
  const hash = scriptsHash(seen)
  const changed = last.has(t.domain) && last.get(t.domain) !== hash
  last.set(t.domain, hash)
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
  txs: string[]
  errors: string[]
  lines: string[] // one per site, for logs
  ms: number
}

// `clients` without a wallet (or null) scans and reports but writes nothing.
export async function runOnce(o: { api: string; clients: ReturnType<typeof arkivClients> | null }): Promise<RunSummary> {
  const { targets: listed } = JSON.parse(await readFile(new URL('../targets.json', import.meta.url), 'utf8')) as { targets: { app?: string; domain: string }[] }
  const started = Date.now()
  const discoveryErrors: string[] = []
  let releases: { app: string; manifest: Manifest }[] = []
  try {
    releases = await discover(o.api, discoveryErrors)
  } catch (err) {
    discoveryErrors.push(`release discovery failed, all targets unbound: ${rootCause(err)}. Check the API at ${o.api} and rerun`)
  }
  const targets = bindTargets(listed, releases)
  const results = await pool(targets, 4, (t) => scan(t)) // 4 sites at a time, each fetched politely
  const lines = results.map((r) => {
    const note = [r.changed ? 'CHANGED SINCE LAST RUN' : '', r.runtime.length ? `runtime: ${r.runtime.join(' ')}` : '', ...r.problems.slice(0, 3)].filter(Boolean).join('; ')
    return `${r.status.padEnd(8)} ${r.t.domain.padEnd(28)} ${String(r.seen.length).padStart(3)} scripts ${note}`
  })
  const summary: RunSummary = { sites: results.length, written: 0, txs: [], errors: discoveryErrors, lines, ms: 0 }
  const wallet = o.clients?.walletClient
  if (o.clients && wallet) {
    const specs: CreateSpec[] = results.map((r) => ({
      schema: ObservationSchema,
      values: observationValues({
        domain: r.t.domain,
        app: r.t.app,
        status: r.status,
        observedAt: started,
        scriptsHash: r.hash,
        payload: { scripts: r.seen.map((s) => ({ url: s.url, sha256: s.sha256 ?? 'unreadable' })), problems: r.problems, changed: r.changed, via: r.via, runtime_origins: r.runtime } as never,
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
