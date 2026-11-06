// Which app a hostname belongs to. A release lists a domain in its manifest only after the API saw
// the domain serve hydra.txt for that app (T-A19). Pure: rows in, app out.

export interface DomainRelease {
  app: string
  publisher: string
  published_at: unknown
  domains: string[]
}

// Only releases created by the app's current owner count (owners: app -> lowercased address). The
// earliest app to prove a domain keeps it, so a later claim on the same domain cannot move it, and
// a hijacker who proves it again under another app cannot silence the check.
export function appForDomain(releases: DomainRelease[], owners: Record<string, string>, domain: string): string | null {
  const host = domain.toLowerCase()
  let best: { app: string; at: number } | null = null
  for (const r of releases) {
    const owner = owners[r.app]
    const at = Number(r.published_at)
    if (!owner || r.publisher.toLowerCase() !== owner.toLowerCase() || !Number.isFinite(at)) continue
    if (!r.domains.some((d) => d.toLowerCase() === host)) continue
    if (!best || at < best.at) best = { app: r.app, at }
  }
  return best?.app ?? null
}
