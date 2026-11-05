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
