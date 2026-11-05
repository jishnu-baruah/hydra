// Indexer: every INDEXER_INTERVAL_MIN (15) minutes, fetch each target's page, hash the scripts it
// loads, compare them with the app's latest Hydra release, and write 1 observation per target to
// Arkiv. Observations expire after 3 days, so "checked recently" is simply "an observation exists".
//   node src/main.ts            run forever
//   node src/main.ts --once     one run
//   node src/main.ts --dry      one run, print only, no writes
// Env: ARKIV_INDEXER_PRIVATE_KEY, ARKIV_ACCESS_KEY (optional), HYDRA_API_URL.

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
import type { Hex } from 'viem'
import { compare, scriptUrls, scriptsHash, sha256Tag, type Manifest, type Seen } from './scan.ts'

const env = process.env
const DRY = process.argv.includes('--dry')
const ONCE = DRY || process.argv.includes('--once')
const API = (env.HYDRA_API_URL ?? 'https://hydra-api-5xmn.onrender.com').replace(/\/+$/, '')
const INTERVAL_MS = Number(env.INDEXER_INTERVAL_MIN ?? 15) * 60_000
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
async function manifestFor(app: string | undefined): Promise<Manifest | null> {
  if (!app) return null
  try {
    const res = await fetch(`${API}/v1/apps/${encodeURIComponent(app)}/releases`, { signal: AbortSignal.timeout(60_000) })
    const { releases } = (await res.json()) as { releases?: { payload?: { manifest?: Manifest } }[] }
    return releases?.[0]?.payload?.manifest ?? null
  } catch {
    return null
  }
}

const last = new Map<string, string>() // domain -> scripts_hash from the previous run

async function scan(t: Target) {
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
    const r = compare(pageUrl, seen, await manifestFor(t.app))
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

async function run(clients: ReturnType<typeof arkivClients> | null) {
  const { targets } = JSON.parse(await readFile(new URL('../targets.json', import.meta.url), 'utf8')) as { targets: Target[] }
  const started = Date.now()
  const results = []
  for (const t of targets) results.push(await scan(t)) // one site at a time: polite to targets
  for (const r of results) {
    const note = [r.changed ? 'CHANGED SINCE LAST RUN' : '', ...r.problems.slice(0, 3)].filter(Boolean).join('; ')
    console.log(`${r.status.padEnd(8)} ${r.t.domain.padEnd(28)} ${String(r.seen.length).padStart(3)} scripts ${note}`)
  }
  if (!clients?.walletClient) return console.log(`dry run: ${results.length} sites in ${Date.now() - started} ms, 0 writes`)

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
    // Guarded: one transaction, never resent. A failure is logged and the next run carries on.
    try {
      const { txHash } = await guardedBatch({ ...clients, walletClient: clients.walletClient, creates: specs.slice(i, i + BATCH) })
      console.log(`wrote ${Math.min(BATCH, specs.length - i)} observations: tx ${txHash}`)
    } catch (err) {
      console.error(`observation batch ${i / BATCH + 1} not written: ${rootCause(err)}`)
    }
  }
}

const key = env.ARKIV_INDEXER_PRIVATE_KEY as Hex | undefined
if (!DRY && !key) {
  console.error('ARKIV_INDEXER_PRIVATE_KEY is not set; use --dry to scan without writing.')
  process.exit(1)
}
const clients = DRY ? null : arkivClients({ accessKey: env.ARKIV_ACCESS_KEY, privateKey: key })
if (clients) console.log(`indexer wallet ${clients.walletClient!.account.address}, every ${INTERVAL_MS / 60_000} min`)

do {
  const t0 = Date.now()
  await run(clients).catch((err) => console.error(`run failed: ${rootCause(err)}`))
  if (ONCE) break
  await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - t0))))
} while (true)
