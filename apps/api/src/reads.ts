// Read routes for the site and explorer, so the Arkiv access key stays on the server.
//
// Trust: anyone can write a `hydra.*` record to Arkiv with their own wallet, so every read keeps
// only records created by our publisher wallet (`writer`). An app name belongs to the address in
// its earliest `hydra.app` record; releases and files from any other address are dropped.

import { AppSchema, FileSchema, ReleaseSchema, eq, readWithRetry } from '@hydra/core'
import { hexToString, type Hex } from 'viem'

type Query = {
  from: (s: unknown) => Query
  where: (w: unknown) => Query
  createdBy: (a: Hex) => Query
  limit: (n: number) => Query
  orderBy: (o: unknown) => Query
  fetch: () => Promise<{ entities: Record<string, unknown>[] }>
}
type Reader = { select: (cols: never) => Query }

// Typed columns come back as { value }; flatten them and make bigints JSON-safe.
const plain = (v: unknown): unknown => {
  const x = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v
  return typeof x === 'bigint' ? x.toString() : x
}

function row(e: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) out[k] = plain(v)
  return out
}

const fetchRows = (reader: unknown, writer: Hex, schema: unknown, cols: Record<string, true>, filter?: unknown, limit = 50) =>
  readWithRetry(() => {
    const q = (reader as Reader).select(cols as never).from(schema)
    return (filter === undefined ? q : q.where(filter)).createdBy(writer).limit(limit).fetch()
  }).then((page) => page.entities.map(row))

const ciRunUrl = (body: unknown): string | null => {
  try {
    const url = JSON.parse(hexToString(body as Hex))?.ci_run_url
    return typeof url === 'string' && url.startsWith('https://github.com/') ? url : null
  } catch {
    return null
  }
}

// Everything our wallet wrote, newest block first: app claims, releases and file records. A temp
// activity feed until the explorer's events timeline lands; `limit` is per record type.
export async function activity(reader: unknown, writer: Hex, limit = 100) {
  const [apps, releases, files] = await Promise.all([
    fetchRows(reader, writer, AppSchema, { $key: true, $createdAt: true, $expiresAt: true, app: true, publisher: true }, undefined, limit),
    fetchRows(reader, writer, ReleaseSchema, { $key: true, $createdAt: true, $expiresAt: true, app: true, publisher: true, version: true, commit: true, file_count: true, swarm_ref: true, body: true }, undefined, limit),
    fetchRows(reader, writer, FileSchema, { $key: true, $createdAt: true, $expiresAt: true, app: true, path: true, sha256: true, release: true }, undefined, limit),
  ])
  const order = { app: 0, release: 1, file: 2 }
  const events = [
    ...apps.map((r) => ({ kind: 'app' as const, ...r })),
    ...releases.map(({ body, ...r }) => ({ kind: 'release' as const, ...r, ci_run_url: ciRunUrl(body) })),
    ...files.map((r) => ({ kind: 'file' as const, ...r })),
  ].map(({ $createdAt, $expiresAt, ...e }) => ({ block: Number($createdAt ?? 0), expires_at: Number($expiresAt ?? 0), ...e }))
  // The head and block time let a page turn expiry blocks into dates.
  const t = await readWithRetry(() => (reader as { getBlockTiming: () => Promise<{ currentBlock: bigint; currentBlockTime: number; blockDuration: number }> }).getBlockTiming())
  return {
    head: { block: Number(t.currentBlock), time: t.currentBlockTime, blockSeconds: t.blockDuration },
    events: events.sort((a, b) => b.block - a.block || order[a.kind] - order[b.kind]),
  }
}

export interface Claim {
  owner: string // lowercased
  key: Hex // the hydra.app entity, extended on every publish
  expiresAt: number // block
}

// The live claim on `app`, or null if nobody holds it. Arkiv drops expired claims, so a lapsed
// lease frees the name with no cleanup on our side.
export async function claimOf(reader: unknown, writer: Hex, app: string): Promise<Claim | null> {
  const rows = await fetchRows(reader, writer, AppSchema, { $key: true, $expiresAt: true, publisher: true, created_at: true }, eq('app', app))
  rows.sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0))
  const r = rows[0]
  return r ? { owner: String(r.publisher).toLowerCase(), key: r.$key as Hex, expiresAt: Number(r.$expiresAt) } : null
}

export async function releasesFor(reader: unknown, writer: Hex, app: string) {
  const owner = (await claimOf(reader, writer, app))?.owner
  if (!owner) return []
  const cols = { $key: true, app: true, publisher: true, version: true, commit: true, swarm_ref: true, file_count: true, published_at: true, body: true } as const
  const rows = await fetchRows(reader, writer, ReleaseSchema, cols, eq('app', app))
  return rows
    .filter((r) => String(r.publisher).toLowerCase() === owner)
    .map((r) => {
      let payload: unknown = null
      try {
        payload = typeof r.body === 'string' ? JSON.parse(hexToString(r.body as Hex)) : null
      } catch {
        payload = null
      }
      delete r.body
      return { ...r, payload }
    })
    .sort((a, b) => Number(b.published_at ?? 0) - Number(a.published_at ?? 0))
}

// Files with this hash, kept only when their release is one of the app owner's releases.
export async function filesByHash(reader: unknown, writer: Hex, sha256: string) {
  const rows = await fetchRows(reader, writer, FileSchema, { $key: true, app: true, sha256: true, path: true, release: true }, eq('sha256', sha256))
  const trusted = new Map<string, Set<unknown>>()
  for (const app of new Set(rows.map((r) => String(r.app)))) {
    trusted.set(app, new Set((await releasesFor(reader, writer, app)).map((r) => r.$key)))
  }
  return rows.filter((r) => trusted.get(String(r.app))?.has(r.release))
}
