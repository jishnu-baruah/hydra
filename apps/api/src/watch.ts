// The demo watcher: one in-memory loop that checks one bound site every 5 seconds. A tick reads and
// writes nothing on Arkiv. Only when the verdict flips (match to mismatch, or back) does it run the
// normal one-site observation write and Telegram alert, once. It switches itself off after a limit.
// All effects are injected, so the state machine runs under `node --test` with no network or clock.

export type Verdict = 'match' | 'mismatch' | 'unreachable'

export interface TickResult {
  verdict: Verdict
  problems: string[]
  scripts: number
  ms: number
}

export interface WatchTarget {
  domain: string
  app: string
  manifest: unknown
}

export interface Flip {
  at: number
  from: Verdict
  to: Verdict
  alert: 'pending' | 'done' | 'failed'
  note?: string
}

export interface WatchStatus {
  on: boolean
  domain: string | null
  app: string | null
  startedAt: number | null
  expiresAt: number | null
  intervalMs: number
  last: (TickResult & { at: number }) | null
  ticks: { at: number; verdict: Verdict }[]
  flips: Flip[]
  stoppedBecause: string | null
}

export interface WatchDeps {
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  // The bound target for a domain (a release lists it, proven at publish), or null.
  resolve: (domain: string) => Promise<WatchTarget | null>
  tick: (target: WatchTarget) => Promise<TickResult>
  // Writes the observation and sends the alert. Its failure is recorded, never fatal.
  onFlip: (e: { domain: string; app: string; from: Verdict; to: Verdict; at: number }) => Promise<void>
  intervalMs?: number
  maxMs?: number
  refreshMs?: number // how long a resolved target (and its manifest) is trusted before resolving again
}

const KEEP = 30

export function createWatcher(d: WatchDeps) {
  const now = d.now ?? Date.now
  const setTimer = d.setTimer ?? ((fn, ms) => setInterval(fn, ms))
  const clearTimer = d.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>))
  const intervalMs = d.intervalMs ?? 5000
  const maxMs = d.maxMs ?? 15 * 60_000
  const refreshMs = d.refreshMs ?? 60_000

  let target: WatchTarget | null = null
  let resolvedAt = 0
  let handle: unknown
  let on = false
  let busy = false
  let startedAt: number | null = null
  let baseline: Verdict | null = null
  let last: WatchStatus['last'] = null
  let ticks: WatchStatus['ticks'] = []
  let flips: Flip[] = []
  let stoppedBecause: string | null = null

  function stop(why: string | null = null) {
    if (handle !== undefined) clearTimer(handle)
    handle = undefined
    on = false
    if (why) stoppedBecause = why
  }

  async function tickNow(): Promise<void> {
    if (!on || !target || busy) return // a slow site never stacks requests
    const t = now()
    if (startedAt !== null && t - startedAt >= maxMs) return stop('the 15 minute time limit was reached; switch it on again')
    busy = true
    try {
      if (t - resolvedAt >= refreshMs) {
        const fresh = await d.resolve(target.domain)
        if (fresh) {
          target = fresh
          resolvedAt = t
        }
      }
      const r = await d.tick(target)
      last = { ...r, at: t }
      ticks = [...ticks, { at: t, verdict: r.verdict }].slice(-KEEP)
      if (r.verdict === 'unreachable') return // shown, but it moves nothing
      if (baseline === null) {
        baseline = r.verdict
        return
      }
      if (r.verdict !== baseline) {
        const flip: Flip = { at: t, from: baseline, to: r.verdict, alert: 'pending' }
        flips = [...flips, flip]
        baseline = r.verdict
        try {
          await d.onFlip({ domain: target.domain, app: target.app, from: flip.from, to: flip.to, at: t })
          flip.alert = 'done'
        } catch (err) {
          flip.alert = 'failed'
          flip.note = err instanceof Error ? err.message : String(err)
        }
      }
    } finally {
      busy = false
    }
  }

  return {
    async start(domain: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
      const host = domain.trim().toLowerCase()
      const found = await d.resolve(host)
      if (!found) {
        return { ok: false, status: 404, error: `no release binds ${host}; publish with HYDRA_DOMAINS and a hydra.txt for it first` }
      }
      stop()
      target = found
      resolvedAt = now()
      startedAt = now()
      baseline = null
      last = null
      ticks = []
      flips = []
      stoppedBecause = null
      on = true
      await tickNow()
      if (on) handle = setTimer(() => void tickNow(), intervalMs)
      return { ok: true }
    },
    stop: () => stop('switched off'),
    tickNow,
    status(): WatchStatus {
      return {
        on,
        domain: target?.domain ?? null,
        app: target?.app ?? null,
        startedAt,
        expiresAt: on && startedAt !== null ? startedAt + maxMs : null,
        intervalMs,
        last,
        ticks,
        flips,
        stoppedBecause,
      }
    },
  }
}
