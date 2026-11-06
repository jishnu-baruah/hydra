// The rendered second view: Jina's reader loads a page in a real browser from another network. It
// can fail quietly (a credit outage looks like "no runtime scripts"), so this keeps count, names the
// cause, and stops calling after 3 failures in a row instead of burning 250 failing requests.

import { scriptUrls } from './scan.ts'

export interface JinaReport {
  state: 'off' | 'ok' | 'failed'
  calls: number // requests sent
  failed: number // requests that failed (not: pages with no scripts, which are bot checks)
  reason: string // the most recent failure, or why the view is off
  skipped: number // renders not attempted because the breaker was open
}

const STREAK = 3

function why(status: number): string {
  if (status === 402) return 'HTTP 402: Jina credit is out'
  if (status === 401 || status === 403) return `HTTP ${status}: JINA_KEY is wrong or revoked`
  if (status === 429) return 'HTTP 429: Jina is rate limiting this key'
  return `HTTP ${status} from Jina`
}

export function createRenderer(o: { key: string | undefined; fetch?: typeof fetch; timeoutMs?: number }) {
  const f = o.fetch ?? fetch
  let calls = 0
  let failed = 0
  let skipped = 0
  let streak = 0
  let reason = o.key ? '' : 'JINA_KEY is not set'

  return {
    // The page's HTML as a browser renders it, or null (no key, breaker open, failure, or no scripts).
    async render(pageUrl: string): Promise<string | null> {
      if (!o.key) return null
      if (streak >= STREAK) {
        skipped++
        return null
      }
      calls++
      try {
        const res = await f(`https://r.jina.ai/${pageUrl}`, {
          headers: { Authorization: `Bearer ${o.key}`, 'X-Return-Format': 'html' },
          signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
        })
        if (!res.ok) {
          failed++
          streak++
          reason = why(res.status)
          return null
        }
        streak = 0
        const html = await res.text()
        return scriptUrls(html, pageUrl).length ? html : null // no scripts: a bot-check page, not a failure
      } catch (err) {
        failed++
        streak++
        reason = err instanceof Error && err.name === 'TimeoutError' ? 'Jina timed out' : 'network error reaching Jina'
        return null
      }
    },
    report(): JinaReport {
      const state = !o.key ? 'off' : streak >= STREAK ? 'failed' : 'ok'
      return { state, calls, failed, reason, skipped }
    },
  }
}
