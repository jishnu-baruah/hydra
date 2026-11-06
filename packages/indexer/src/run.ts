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
import { alertText, sendTelegram } from './alerts.ts'
import { createRenderer, type JinaReport } from './jina.ts'
import { onlyTargets, shouldWrite, topTargets } from './coverage.ts'
import { bindTargets, compare, proofProblem, runtimeProblems, scriptUrls, scriptHash, scriptsHash, type BoundTarget, type Manifest, type Seen } from './scan.ts'

const MAX_SCRIPTS = 60
const MAX_BYTES = 5 * 1024 * 1024
const BATCH = 10 // observations per transaction; 20 targets is 2 transactions

type Target = BoundTarget

// Pages and scripts come from domains a publisher chose, so they are fetched only from public
// addresses, https only, pinned, with each redirect rechecked (safeGet in @hydra/core).
const get = (url: string, timeoutMs = 15_000): Promise<Uint8Array> => safeGet(url, { maxBytes: MAX_BYTES, timeoutMs })

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

async function scan(t: Target, prev: Prev | undefined, now: number, rendered: (url: string) => Promise<string | null>) {
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
  // Only a run that read scripts can differ from one that did: an outage is not a change.
  const changed = !!prev && seen.length > 0 && prev.scripts_hash !== EMPTY && prev.scripts_hash !== hash
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
  alerts: number // news sent to Telegram (or only logged on a dry run or without Telegram config)
  txs: string[]
  errors: string[]
  lines: string[] // notable sites plus one count line, for logs
  ms: number
  jina?: JinaReport // the rendered second view: calls, failures and the cause
}

export { sendTelegram } // the API sends apps' Telegram channels through the same bot

export interface AlertEvent {
  app?: string // undefined for a site no release binds
  domain: string
  from: string // previous status
  to: string
  problems: string[]
  text: string // the plain-text message, as sent to Telegram
  observedAt: number
}

// One message per site with news: to the Hydra team chat (env TELEGRAM_*) and to `notify`, the
// app's own channels. A dry run (live false) only logs. Never throws: failures land in errors.
export async function sendAlerts(
  sites: { domain: string; app?: string; status: string; problems: string[]; prev: { status: string; problems: string[] } | null }[],
  at: number,
  o: { live: boolean; token?: string; chatId?: string; notify?: (e: AlertEvent) => Promise<void>; send?: typeof sendTelegram },
): Promise<{ alerts: number; lines: string[]; errors: string[] }> {
  const out = { alerts: 0, lines: [] as string[], errors: [] as string[] }
  for (const s of sites) {
    const text = alertText(s, s.prev, at)
    if (!text) continue
    out.alerts++
    out.lines.push(`ALERT ${text.split('\n')[0]}`)
    if (!o.live) continue // dry run: logged only
    if (o.token && o.chatId) {
      const sent = await (o.send ?? sendTelegram)({ token: o.token, chatId: o.chatId, text })
      if (!sent.ok) out.errors.push(`alert for ${s.domain} not sent: ${sent.error}`)
    }
    if (o.notify) {
      try {
        await o.notify({ app: s.app, domain: s.domain, from: s.prev?.status ?? 'unknown', to: s.status, problems: s.problems, text, observedAt: at })
      } catch (err) {
        out.errors.push(`alert channels for ${s.domain} failed: ${rootCause(err)}`)
      }
    }
  }
  return out
}

const PREV_WINDOW = 3 * DAY
const LLAMA = 'https://api.llama.fi/protocols'
const EMPTY = scriptsHash([]) // the hash of a run that read no scripts

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
// `notify` gets every alert a live run sends, for the app's own alert channels (T-A30).
export async function runOnce(o: { api: string; clients: ReturnType<typeof arkivClients> | null; indexerAddress?: Hex; only?: string; notify?: (e: AlertEvent) => Promise<void> }): Promise<RunSummary> {
  const only = o.only ?? process.env.INDEXER_ONLY // a comma list of domains: a one-site run (T-A23), or the live watcher's flip (T-A25)
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
    if (only) throw new Error('one-site run')
    const res = await fetch(LLAMA, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const apps = new Map(listed.map((e) => [e.domain.toLowerCase(), e.app]))
    merged = topTargets(await res.json(), Number(process.env.INDEXER_TOP ?? 227), listed).map((e) => ({ ...e, app: apps.get(e.domain.toLowerCase()) }))
  } catch (err) {
    if (!only) errors.push(`DefiLlama discovery failed, scanning targets.json only: ${rootCause(err)}. Check ${LLAMA} and rerun`)
  }
  const category = new Map(merged.map((e) => [e.domain.toLowerCase(), e.category]))
  const targets = onlyTargets(bindTargets(merged, releases), only)

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

  const jina = createRenderer({ key: process.env.JINA_KEY })
  const results = await pool(targets, Number(process.env.INDEXER_POOL ?? 8), (t) => scan(t, prevs.get(t.domain), started, jina.render))
  const due = results.filter((r) => shouldWrite(prevs.get(r.t.domain) ?? null, { status: r.status, scripts_hash: r.hash, problems: r.problems }, started))
  const lines = results
    .filter((r) => r.status !== 'unknown' || r.problems.length || r.changed)
    .map((r) => {
      const note = [r.changed ? 'CHANGED SINCE LAST RUN' : '', r.runtime.length ? `runtime: ${r.runtime.join(' ')}` : '', ...r.problems.slice(0, 3)].filter(Boolean).join('; ')
      return `${r.status.padEnd(8)} ${r.t.domain.padEnd(28)} ${String(r.seen.length).padStart(3)} scripts ${note}`
    })
  const count = (st: string) => results.filter((r) => r.status === st).length
  lines.push(`${results.length} sites: ${count('match')} match, ${count('mismatch')} mismatch, ${count('unknown')} unknown; ${due.length} to write, ${results.length - due.length} unchanged`)
  // The second view fails quietly (a failed render just reuses the previous run's origins), so say so.
  const jr = jina.report()
  if (jr.failed > 0) {
    const fix = /402/.test(jr.reason) ? 'top up the Jina account' : /40[13]/.test(jr.reason) ? 'replace JINA_KEY on the host' : 'check https://status.jina.ai and rerun'
    errors.push(
      `Jina second view failed ${jr.failed} of ${jr.calls} renders (${jr.reason})${jr.skipped ? `, ${jr.skipped} more were not tried` : ''}. ` +
        `Runtime-only script origins and sites that block direct fetches were not checked this run; earlier results were reused. To fix: ${fix}.`,
    )
  } else if (jr.state === 'off') lines.push(`Jina second view is off (${jr.reason}); runtime-only script origins are not checked`)
  const summary: RunSummary = { sites: results.length, written: 0, skipped: results.length - due.length, txs: [], errors, lines, ms: 0, alerts: 0, jina: jr }
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
  // Alerts come only from sites whose state changed (due). The next run reads this run's
  // observation as previous, so the same news is not sent twice; a failed write may repeat it.
  const sent = await sendAlerts(
    due.map((r) => ({ domain: r.t.domain, app: r.t.app, status: r.status, problems: r.problems, prev: prevs.get(r.t.domain) ?? null })),
    started,
    { live: !!wallet, token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, notify: o.notify },
  )
  summary.alerts = sent.alerts
  summary.lines.push(...sent.lines)
  summary.errors.push(...sent.errors)
  summary.ms = Date.now() - started
  return summary
}
