// One indexer pass: fetch each target's page, hash the scripts it loads, compare them with the
// app's latest Hydra release, and write 1 observation per target to Arkiv (3-day expiry, so
// "checked recently" is "an observation exists"). Used by the CLI (main.ts) and by the API's
// POST /v1/indexer/run, which a scheduled GitHub Actions job calls.

import { readFile } from 'node:fs/promises'
import {
  OBSERVATION_TTL,
  ObservationSchema,
  arkivClients,
  guardedBatch,
  observationValues,
  rootCause,
  type CreateSpec,
} from '@hydra/core'
import { compare, scriptUrls, scriptsHash, sha256Tag, type Manifest, type Seen } from './scan.ts'

const MAX_SCRIPTS = 60
const MAX_BYTES = 5 * 1024 * 1024
const BATCH = 10 // observations per transaction; 20 targets is 2 transactions
const UA = 'HydraIndexer/0.1 (+https://hydra-site-one.vercel.app)'

interface Target {
  app?: string
  domain: string
}

async function get(url: string, timeoutMs = 15_000): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) throw new Error(`over ${MAX_BYTES} bytes`)
  return buf
}

// The newest release's manifest for a Hydra app, read through the API's trust-filtered route.
async function manifestFor(api: string, app: string | undefined): Promise<Manifest | null> {
  if (!app) return null
  try {
    const res = await fetch(`${api}/v1/apps/${encodeURIComponent(app)}/releases`, { signal: AbortSignal.timeout(60_000) })
    const { releases } = (await res.json()) as { releases?: { payload?: { manifest?: Manifest } }[] }
    return releases?.[0]?.payload?.manifest ?? null
  } catch {
    return null
  }
}

// Previous scripts_hash per domain, for "changed since last run". In memory: a restart (or a free
// Render service waking up) forgets it, so the first run after one reports no changes.
const last = new Map<string, string>()

async function scan(api: string, t: Target) {
  const pageUrl = `https://${t.domain}/`
  let seen: Seen[] = []
  let problems: string[] = []
  let status: 'match' | 'mismatch' | 'unknown' = 'unknown'
  try {
    const html = new TextDecoder().decode(await get(pageUrl))
    const urls = scriptUrls(html, pageUrl)
    if (urls.length > MAX_SCRIPTS) problems.push(`TRUNCATED ${urls.length} scripts, checked ${MAX_SCRIPTS}`)
    seen = await Promise.all(
      urls.slice(0, MAX_SCRIPTS).map(async (url) => ({ url, sha256: await get(url).then(sha256Tag, () => null) })),
    )
    const r = compare(pageUrl, seen, await manifestFor(api, t.app))
    status = r.status
    problems = [...problems, ...r.problems]
  } catch (err) {
    problems.push(`UNREACHABLE ${rootCause(err)}`)
  }
  const hash = scriptsHash(seen)
  const changed = last.has(t.domain) && last.get(t.domain) !== hash
  last.set(t.domain, hash)
  return { t, status, seen, problems, hash, changed }
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
  const { targets } = JSON.parse(await readFile(new URL('../targets.json', import.meta.url), 'utf8')) as { targets: Target[] }
  const started = Date.now()
  const results = []
  for (const t of targets) results.push(await scan(o.api, t)) // one site at a time: polite to targets
  const lines = results.map((r) => {
    const note = [r.changed ? 'CHANGED SINCE LAST RUN' : '', ...r.problems.slice(0, 3)].filter(Boolean).join('; ')
    return `${r.status.padEnd(8)} ${r.t.domain.padEnd(28)} ${String(r.seen.length).padStart(3)} scripts ${note}`
  })
  const summary: RunSummary = { sites: results.length, written: 0, txs: [], errors: [], lines, ms: 0 }
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
        payload: { scripts: r.seen.map((s) => ({ url: s.url, sha256: s.sha256 ?? 'unreadable' })), problems: r.problems, changed: r.changed } as never,
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
