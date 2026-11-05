// Read routes for the site and explorer, so the Arkiv access key stays on the server.

import { FileSchema, ReleaseSchema, readWithRetry } from '@hydra/core'
import { eq } from '@arkiv-network/sdk/query'
import { hexToString } from 'viem'

type Reader = {
  select: (...a: never[]) => { from: (s: unknown) => { where: (w: unknown) => { limit: (n: number) => { fetch: () => Promise<{ entities: Record<string, unknown>[] }> } } } }
}

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

export async function releasesFor(reader: unknown, app: string) {
  const r = reader as Reader
  const page = await readWithRetry(() =>
    r
      .select({ $key: true, app: true, publisher: true, version: true, commit: true, swarm_ref: true, file_count: true, published_at: true, body: true } as never)
      .from(ReleaseSchema)
      .where(eq('app', app))
      .limit(50)
      .fetch(),
  )
  return page.entities
    .map((e) => {
      const r = row(e)
      let payload: unknown = null
      try {
        payload = typeof r.body === 'string' ? JSON.parse(hexToString(r.body as `0x${string}`)) : null
      } catch {
        payload = null
      }
      delete r.body
      return { ...r, payload }
    })
    .sort((a, b) => Number(b.published_at ?? 0) - Number(a.published_at ?? 0))
}

export async function filesByHash(reader: unknown, sha256: string) {
  const r = reader as Reader
  const page = await readWithRetry(() =>
    r
      .select({ $key: true, app: true, sha256: true, path: true, release: true } as never)
      .from(FileSchema)
      .where(eq('sha256', sha256))
      .limit(50)
      .fetch(),
  )
  return page.entities.map(row)
}
