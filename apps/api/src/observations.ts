// Per-site view of the indexer's observations, for the /indexed/ page. Pure: rows in, view out.

import { hexToString, type Hex } from 'viem'

export interface TargetInfo {
  app?: string
  domain: string
  category?: string
}

// An observation as read from Arkiv, columns already flattened.
export interface ObservationRow {
  $key: string
  $expiresAt?: number | string
  domain: string
  status: string
  observed_at: string | number
  scripts_hash: string
  body?: unknown
}

export interface Snapshot {
  observed_at: number
  status: string
  scripts: number
  hash: string
  changed: boolean
  via: string
  problems: string[]
  runtime_origins: string[]
  entity: string
  expires_at: number
}

type Body = { scripts?: unknown[]; problems?: unknown[]; changed?: unknown; via?: unknown; runtime_origins?: unknown[] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function snapshot(r: ObservationRow): Snapshot {
  let b: Body = {}
  try {
    if (typeof r.body === 'string') b = JSON.parse(hexToString(r.body as Hex)) as Body
  } catch {
    b = {}
  }
  return {
    observed_at: Number(r.observed_at),
    status: r.status,
    scripts: Array.isArray(b.scripts) ? b.scripts.length : 0,
    hash: String(r.scripts_hash).slice(0, 14),
    changed: b.changed === true,
    via: typeof b.via === 'string' ? b.via : 'direct',
    problems: strings(b.problems),
    runtime_origins: strings(b.runtime_origins),
    entity: r.$key,
    expires_at: Number(r.$expiresAt ?? 0),
  }
}

export function sitesView(targets: TargetInfo[], rows: ObservationRow[]) {
  const byDomain = new Map<string, Snapshot[]>()
  for (const r of rows) {
    const list = byDomain.get(r.domain) ?? []
    list.push(snapshot(r))
    byDomain.set(r.domain, list)
  }
  const sites = targets.map((t) => {
    const history = (byDomain.get(t.domain) ?? []).sort((a, b) => b.observed_at - a.observed_at)
    const latest = history[0] ?? null
    const state = latest ? latest.status : 'pending'
    return { domain: t.domain, app: t.app ?? null, category: t.category ?? 'other', state, latest, history }
  })
  const states: Record<string, number> = { match: 0, mismatch: 0, unknown: 0, pending: 0 }
  const categories: Record<string, number> = {}
  for (const s of sites) {
    states[s.state] = (states[s.state] ?? 0) + 1
    categories[s.category] = (categories[s.category] ?? 0) + 1
  }
  const lastRun = sites.reduce((m, s) => Math.max(m, s.latest?.observed_at ?? 0), 0)
  return { summary: { sites: sites.length, states, categories, lastRun }, sites }
}
