// Reads shared by the API and the indexer. Only records created by the given wallet count.

import { ObservationSchema } from './records.ts'
import { readAll } from './arkiv.ts'
import { desc, gte } from '@arkiv-network/sdk/query'
import { u64 } from '@arkiv-network/sdk/schema'
import type { Hex } from 'viem'

type Query = {
  from: (s: unknown) => Query
  where: (w: unknown) => Query
  createdBy: (a: Hex) => Query
  orderBy: (o: unknown) => Query
  limit: (n: number) => Query
  offset: (n: number) => Query
  fetch: () => Promise<{ entities: Record<string, unknown>[]; skipped: number }>
}

// Typed columns come back as { value }; flatten them and make bigints JSON-safe.
const plain = (v: unknown): unknown => {
  const x = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v
  return typeof x === 'bigint' ? x.toString() : x
}
export const flat = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, plain(v)]))

// The indexer wallet's observations since `sinceMs`, newest first, every page.
export const recentObservations = (reader: unknown, indexer: Hex, sinceMs: number, maxRows = 3000) =>
  readAll(
    (offset) =>
      (reader as { select: (c: never) => Query })
        .select({ $key: true, $expiresAt: true, domain: true, app: true, status: true, observed_at: true, scripts_hash: true, body: true } as never)
        .from(ObservationSchema)
        .where(gte('observed_at', u64(BigInt(Math.floor(sinceMs))) as never))
        .createdBy(indexer)
        .orderBy(desc('observed_at'))
        .limit(100)
        .offset(offset)
        .fetch(),
    maxRows,
  ).then((rows) => rows.map(flat))
