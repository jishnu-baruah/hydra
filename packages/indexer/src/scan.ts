// Pure parts of the indexer: which scripts a page loads, and whether they match a release.
// Spike T4 (static sites) and T12 (Next.js): compare scripts by policy, never whole HTML.
// HTML parsing here is regex-grade over tag attributes; everything fetched is data, never run.

import { createHash } from 'node:crypto'

export interface Seen {
  url: string
  sha256: string | null // null: the script could not be fetched
}

export interface Manifest {
  files: Record<string, string> // "/path" -> "sha256-<hex>"
  scripts?: Record<string, string> // external https URL -> "sha256-<hex>"
  domains?: string[] // domains the API verified (hydra.txt) at publish time
}

const TAG = /<(script|link)\b([^>]*)>/gi
const attr = (attrs: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs)?.slice(1).find((v) => v !== undefined)

// Absolute http(s) URLs of every <script src> and <link rel=modulepreload|preload as=script>, in
// page order, deduped. Inline scripts are skipped (Next.js Flight pushes; T12 policy).
export function scriptUrls(html: string, pageUrl: string): string[] {
  const out = new Set<string>()
  for (const [, tag, attrs] of html.matchAll(TAG)) {
    let ref: string | undefined
    if (tag.toLowerCase() === 'script') ref = attr(attrs, 'src')
    else {
      const rel = (attr(attrs, 'rel') ?? '').toLowerCase()
      if (rel === 'modulepreload' || (rel === 'preload' && (attr(attrs, 'as') ?? '').toLowerCase() === 'script')) ref = attr(attrs, 'href')
    }
    if (!ref) continue
    try {
      const u = new URL(ref.trim(), pageUrl)
      if (u.protocol === 'https:' || u.protocol === 'http:') out.add(u.href)
    } catch {
      // malformed URL: not a script we can check
    }
  }
  return [...out]
}

export const sha256Tag = (data: Uint8Array | string) => `sha256-${createHash('sha256').update(data).digest('hex')}`

// Some sites answer a script URL with an HTML page (a bot check or SPA fallback) that differs on
// every request. That is not a script, so it counts as unreadable instead of a change each run.
export const scriptHash = (data: Uint8Array): string | null =>
  /^\s*</.test(new TextDecoder().decode(data.subarray(0, 64))) ? null : sha256Tag(data)

// One hash over the whole script set, so "did anything change since last run" is one comparison.
export function scriptsHash(seen: Seen[]): string {
  return sha256Tag(seen.map((s) => `${s.url} ${s.sha256}`).sort().join('\n'))
}

// match: every script is in the release with the same hash. mismatch: something changed, is foreign
// or could not be read. unknown: no release to compare with.
export function compare(pageUrl: string, seen: Seen[], manifest: Manifest | null) {
  if (!manifest) return { status: 'unknown' as const, problems: [] as string[] }
  const origin = new URL(pageUrl).origin
  const problems: string[] = []
  for (const s of seen) {
    const u = new URL(s.url)
    const local = u.origin === origin
    const name = local ? u.pathname : s.url
    const want = local ? manifest.files[u.pathname] : manifest.scripts?.[s.url]
    if (s.sha256 === null) problems.push(`UNREADABLE ${name}`)
    else if (!want) problems.push(`EXTRA ${name}`)
    else if (want !== s.sha256) problems.push(`CHANGED ${name}`)
  }
  return { status: problems.length ? ('mismatch' as const) : ('match' as const), problems }
}

const originOf = (u: string) => {
  try {
    return new URL(u).origin
  } catch {
    return null
  }
}

// Second view (spike T8 idea, a renderer on another network): third-party script origins that only
// appear once the page runs in a browser, e.g. a loader pulling in a drainer at runtime. With a
// release, any such origin the release does not list is RUNTIME_ORIGIN (a mismatch). Without one,
// only origins new since the previous run are flagged, since many sites load analytics at runtime.
export function runtimeProblems(o: {
  pageUrl: string
  raw: string[]
  rendered: string[]
  manifest: Manifest | null
  previous?: string[]
}) {
  const own = originOf(o.pageUrl)
  const known = new Set(o.raw.map(originOf))
  const origins = [...new Set(o.rendered.map(originOf))]
    .filter((x): x is string => !!x && x !== own && !known.has(x))
    .sort()
  let problems: string[] = []
  if (o.manifest) {
    const allowed = new Set(Object.keys(o.manifest.scripts ?? {}).map(originOf))
    problems = origins.filter((x) => !allowed.has(x)).map((x) => `RUNTIME_ORIGIN ${x}`)
  } else if (o.previous) {
    const before = new Set(o.previous)
    problems = origins.filter((x) => !before.has(x)).map((x) => `NEW_RUNTIME_ORIGIN ${x}`)
  }
  return { origins, problems }
}

export interface BoundTarget {
  domain: string
  app?: string
  manifest: Manifest | null
  bound: boolean
}

// A site is compared with a release only when that app's latest manifest lists the domain (the API
// only lists it after the hydra.txt proof passed). A targets.json app label alone binds nothing, so
// claiming a famous app name cannot produce a false mismatch. Two apps naming one domain: bind none.
export function bindTargets(
  listed: { app?: string; domain: string }[],
  releases: { app: string; manifest: Manifest }[],
): BoundTarget[] {
  const claims = new Map<string, { app: string; manifest: Manifest }[]>()
  for (const r of releases)
    for (const d of new Set((r.manifest.domains ?? []).map((x) => x.toLowerCase())))
      claims.set(d, [...(claims.get(d) ?? []), r])
  const out = new Map<string, BoundTarget>()
  for (const t of listed) {
    const domain = t.domain.toLowerCase()
    const c = claims.get(domain)
    out.set(domain, c?.length === 1 ? { domain, app: c[0].app, manifest: c[0].manifest, bound: true } : { domain, app: t.app, manifest: null, bound: false })
  }
  for (const [domain, c] of claims) if (!out.has(domain)) out.set(domain, c.length === 1 ? { domain, app: c[0].app, manifest: c[0].manifest, bound: true } : { domain, app: undefined, manifest: null, bound: false })
  return [...out.values()]
}

// A bound domain whose hydra.txt proof no longer holds: a hijacker could have removed the file.
// LOST means the site answered without the proof (or resolves privately): a mismatch on its own.
// UNREACHABLE means the file could not be read at all, so the script compare decides.
export function proofProblem(bound: boolean, result: { ok: true } | { ok: false; reason: string; transient?: true }): string | null {
  if (!bound || result.ok) return null
  return `${result.transient ? 'DOMAIN_PROOF_UNREACHABLE' : 'DOMAIN_PROOF_LOST'} ${result.reason}`
}
