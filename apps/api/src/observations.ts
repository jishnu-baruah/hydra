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

type Body = { category?: unknown; scripts?: unknown[]; problems?: unknown[]; changed?: unknown; via?: unknown; runtime_origins?: unknown[] }

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

const HISTORY = 8

function bodyCategory(r: ObservationRow): string | null {
  try {
    if (typeof r.body !== 'string') return null
    const c = (JSON.parse(hexToString(r.body as Hex)) as Body).category
    return typeof c === 'string' && c ? c : null
  } catch {
    return null
  }
}

// Every domain seen in the rows plus every target. Category: targets.json, else the newest row's body, else other.
export function sitesView(targets: TargetInfo[], rows: ObservationRow[]) {
  const byDomain = new Map<string, ObservationRow[]>()
  for (const r of rows) byDomain.set(r.domain, [...(byDomain.get(r.domain) ?? []), r])
  const listed = new Map(targets.map((t) => [t.domain, t]))
  const domains = [...new Set([...targets.map((t) => t.domain), ...byDomain.keys()])]
  const sites = domains.map((domain) => {
    const t = listed.get(domain)
    const mine = (byDomain.get(domain) ?? []).sort((a, b) => Number(b.observed_at) - Number(a.observed_at))
    const history = mine.slice(0, HISTORY).map(snapshot)
    const latest = history[0] ?? null
    const category = t?.category ?? mine.map(bodyCategory).find(Boolean) ?? 'other'
    const state = latest ? latest.status : 'pending'
    return { domain, app: t?.app ?? null, category, state, latest, history }
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
