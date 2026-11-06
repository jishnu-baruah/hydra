// One fast check of one bound site, for the live demo watcher (T-A25): fetch the page and its
// scripts, recheck the domain proof, compare with the release. Nothing is read from or written to
// Arkiv and no renderer is called, so a tick takes about a second. Every fetch goes through
// safeGet (https, public addresses only, pinned), and the domain is already bound to a release.

import { checkProof, safeGet, type ProofResult } from '@hydra/core'
import { compare, proofProblem, scriptHash, scriptUrls, type Manifest, type Seen } from './scan.ts'

export interface CheckResult {
  verdict: 'match' | 'mismatch' | 'unreachable'
  problems: string[]
  scripts: number
  ms: number
}

export interface CheckDeps {
  get?: (url: string) => Promise<Uint8Array>
  proof?: (domain: string, app: string) => Promise<ProofResult>
}

const MAX_SCRIPTS = 60
const TIMEOUT_MS = 4_000

export async function checkSite(t: { domain: string; app: string; manifest: Manifest }, deps: CheckDeps = {}): Promise<CheckResult> {
  const started = Date.now()
  const get = deps.get ?? ((url: string) => safeGet(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: TIMEOUT_MS }))
  const done = (verdict: CheckResult['verdict'], problems: string[], scripts: number): CheckResult => ({ verdict, problems, scripts, ms: Date.now() - started })
  const pageUrl = `https://${t.domain}/`

  // The proof and the page are checked together. A lost proof is a mismatch on its own (a hijacker
  // controls the domain and could delete the file); one that merely could not be read is ignored.
  const proofP = (deps.proof ?? checkProof)(t.domain, t.app)
  let html: string
  try {
    html = new TextDecoder().decode(await get(pageUrl))
  } catch (err) {
    const lost = proofProblem(true, await proofP)
    if (lost?.startsWith('DOMAIN_PROOF_LOST')) return done('mismatch', [lost], 0)
    return done('unreachable', [`UNREACHABLE ${err instanceof Error ? err.message : String(err)}`], 0)
  }

  const urls = scriptUrls(html, pageUrl).slice(0, MAX_SCRIPTS)
  const seen: Seen[] = await Promise.all(urls.map(async (url) => ({ url, sha256: await get(url).then(scriptHash, () => null) })))
  const lost = proofProblem(true, await proofP)
  const problems: string[] = []
  if (lost?.startsWith('DOMAIN_PROOF_LOST')) problems.push(lost)
  const cmp = compare(pageUrl, seen, t.manifest)
  problems.push(...cmp.problems)

  // A script that could not be read is a network blip as far as a 5-second tick can tell: show it,
  // but do not call it a mismatch. A changed or foreign script, or a lost proof, still is.
  const onlyUnreadable = problems.length > 0 && problems.every((p) => p.startsWith('UNREADABLE'))
  if (onlyUnreadable) return done('unreachable', problems, seen.length)
  return done(problems.length ? 'mismatch' : 'match', problems, seen.length)
}
