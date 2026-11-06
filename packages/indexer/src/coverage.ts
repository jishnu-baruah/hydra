type Problem = { status: string, scripts_hash: string, problems: string[] }

// Problem strings vary run to run ("TRUNCATED 713 scripts"), so only the leading code is compared.
const codes = (ps: string[]) => [...new Set(ps.map((x) => x.split(/\s+/)[0]))].sort()

export function shouldWrite(
  prev: (Problem & { observed_at: number }) | null,
  next: Problem,
  now: number,
  heartbeatMs = 86_400_000,
): boolean {
  if (prev === null) return true
  if (prev.status !== next.status) return true
  if (prev.scripts_hash !== next.scripts_hash) return true
  const a = codes(prev.problems)
  const b = codes(next.problems)
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true
  return now - prev.observed_at >= heartbeatMs
}

export function topTargets(
  protocols: unknown,
  n: number,
  listed: { domain: string, category: string }[],
): { domain: string, category: string }[] {
  const seen = new Set<string>()
  const out: { domain: string, category: string }[] = listed.map((e) => {
    seen.add(e.domain.toLowerCase())
    return { domain: e.domain, category: e.category }
  })
  const rows = Array.isArray(protocols) ? (protocols as unknown[]) : []
  const scored: { domain: string, category: string, tvl: number }[] = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const url = (row as { url?: unknown }).url
    if (typeof url !== 'string' || url === '') continue
    let host: string
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      host = u.hostname.toLowerCase()
    } catch {
      continue
    }
    const tvlRaw = (row as { tvl?: unknown }).tvl
    const tvl = typeof tvlRaw === 'number' && Number.isFinite(tvlRaw) ? tvlRaw : 0
    const catRaw = (row as { category?: unknown }).category
    const category = typeof catRaw === 'string' ? catRaw.toLowerCase() || 'other' : 'other'
    scored.push({ domain: host, category, tvl })
  }
  scored.sort((a, b) => b.tvl - a.tvl)
  for (const s of scored) {
    if (out.length >= listed.length + n) break
    if (seen.has(s.domain)) continue
    seen.add(s.domain)
    out.push({ domain: s.domain, category: s.category })
  }
  return out
}
// INDEXER_ONLY="a.com,b.com": scan just these domains, for a one-site run (the demo, a recheck).
export function onlyTargets<T extends { domain: string }>(targets: T[], spec: string | undefined): T[] {
  const want = new Set((spec ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  return want.size ? targets.filter((t) => want.has(t.domain.toLowerCase())) : targets
}
