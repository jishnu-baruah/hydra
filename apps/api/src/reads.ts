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

const fetchRows = (reader: unknown, writer: Hex, schema: unknown, cols: Record<string, true>, filter: unknown) =>
  readWithRetry(() =>
    (reader as Reader).select(cols as never).from(schema).where(filter).createdBy(writer).limit(50).fetch(),
  ).then((page) => page.entities.map(row))

// The lowercased address that owns `app`, or null if nobody has published it yet.
export async function ownerOf(reader: unknown, writer: Hex, app: string): Promise<string | null> {
  const rows = await fetchRows(reader, writer, AppSchema, { publisher: true, created_at: true }, eq('app', app))
  rows.sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0))
  return rows.length ? String(rows[0].publisher).toLowerCase() : null
}

export async function releasesFor(reader: unknown, writer: Hex, app: string) {
  const owner = await ownerOf(reader, writer, app)
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
