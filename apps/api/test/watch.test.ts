import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWatcher, type TickResult, type Verdict } from '../src/watch.ts'

const T0 = 1_000_000
const target = { domain: 'app.example.com', app: 'demo', manifest: { files: {}, scripts: {} } }
const res = (verdict: Verdict, problems: string[] = []): TickResult => ({ verdict, problems, scripts: 2, ms: 40 })

function rig(verdicts: Verdict[], over: Partial<Parameters<typeof createWatcher>[0]> = {}) {
  let clock = T0
  const flips: { from: Verdict; to: Verdict }[] = []
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = []
  let i = 0
  const w = createWatcher({
    now: () => clock,
    setTimer: (fn, ms) => (timers.push({ fn, ms, cleared: false }), timers.length - 1),
    clearTimer: (h) => void (timers[h as number].cleared = true),
    resolve: async (d) => (d === 'app.example.com' ? target : null),
    tick: async () => res(verdicts[Math.min(i++, verdicts.length - 1)]),
    onFlip: async (e) => void flips.push({ from: e.from, to: e.to }),
    ...over,
  })
  return { w, flips, timers, advance: (ms: number) => (clock += ms) }
}

test('start needs a domain that a release has bound', async () => {
  const { w } = rig(['match'])
  const r = await w.start('nobody.example.com')
  assert.equal(r.ok, false)
  assert.match((r as { error: string }).error, /no release binds/i)
  assert.equal(w.status().on, false)
})

test('start runs a first tick at once, then every 5 s, and sets the baseline without a flip', async () => {
  const { w, flips, timers } = rig(['match'])
  assert.deepEqual(await w.start('App.Example.com'), { ok: true })
  assert.equal(timers[0].ms, 5000)
  const s = w.status()
  assert.equal(s.on, true)
  assert.equal(s.domain, 'app.example.com')
  assert.equal(s.last?.verdict, 'match')
  assert.equal(s.ticks.length, 1)
  assert.equal(flips.length, 0)
})

test('a flip to mismatch fires once, a repeat does not, and the flip back fires again', async () => {
  const { w, flips, advance } = rig(['match', 'match', 'mismatch', 'mismatch', 'mismatch', 'match'])
  await w.start('app.example.com')
  for (let n = 0; n < 5; n++) {
    advance(5000)
    await w.tickNow()
  }
  assert.deepEqual(flips, [{ from: 'match', to: 'mismatch' }, { from: 'mismatch', to: 'match' }])
  const s = w.status()
  assert.equal(s.flips.length, 2)
  assert.equal(s.flips[0].alert, 'done')
})

test('an unreachable tick is shown but is not a flip and does not move the baseline', async () => {
  const { w, flips, advance } = rig(['match', 'unreachable', 'match', 'mismatch'])
  await w.start('app.example.com')
  for (let n = 0; n < 3; n++) {
    advance(5000)
    await w.tickNow()
  }
  assert.deepEqual(flips, [{ from: 'match', to: 'mismatch' }])
  assert.equal(w.status().ticks[1].verdict, 'unreachable')
})

test('a failing onFlip is recorded as failed and does not stop the watch', async () => {
  const { w, advance } = rig(['match', 'mismatch'], { onFlip: async () => { throw new Error('arkiv down') } })
  await w.start('app.example.com')
  advance(5000)
  await w.tickNow()
  const s = w.status()
  assert.equal(s.on, true)
  assert.equal(s.flips[0].alert, 'failed')
  assert.match(s.flips[0].note ?? '', /arkiv down/)
})

test('overlapping ticks are skipped, so a slow site never stacks requests', async () => {
  let release: () => void = () => {}
  let calls = 0
  const { w, advance } = rig(['match'], {
    tick: async () => (calls++, calls === 1 ? res('match') : new Promise<TickResult>((r) => (release = () => r(res('match'))))),
  })
  await w.start('app.example.com')
  advance(5000)
  const slow = w.tickNow()
  await w.tickNow() // overlaps: skipped
  assert.equal(calls, 2)
  release()
  await slow
})

test('it keeps the last 30 ticks only', async () => {
  const { w, advance } = rig(['match'])
  await w.start('app.example.com')
  for (let n = 0; n < 40; n++) {
    advance(5000)
    await w.tickNow()
  }
  assert.equal(w.status().ticks.length, 30)
})

test('it switches itself off after the limit and clears the timer', async () => {
  const { w, timers, advance } = rig(['match'], { maxMs: 60_000 })
  await w.start('app.example.com')
  advance(61_000)
  await w.tickNow()
  assert.equal(w.status().on, false)
  assert.equal(timers[0].cleared, true)
  assert.match(w.status().stoppedBecause ?? '', /time limit/i)
})

test('stop switches it off, and a second start replaces the first without leaking a timer', async () => {
  const { w, timers } = rig(['match'])
  await w.start('app.example.com')
  await w.start('app.example.com')
  assert.equal(timers[0].cleared, true)
  w.stop()
  assert.equal(w.status().on, false)
  assert.equal(timers[1].cleared, true)
})

test('a tick that throws is recorded as unreachable and never escapes, so a bad moment cannot crash the API', async () => {
  let n = 0
  const { w, advance } = rig(['match'], { tick: async () => { if (n++ === 1) throw new Error('socket hang up'); return res('match') } })
  assert.deepEqual(await w.start('app.example.com'), { ok: true })
  advance(5000)
  await w.tickNow() // must not reject
  const s = w.status()
  assert.equal(s.on, true)
  assert.equal(s.last?.verdict, 'unreachable')
  assert.match(s.last?.problems.join(' ') ?? '', /socket hang up/)
})

test('a binding that disappears stops the watch instead of checking against a stale release', async () => {
  let bound = true
  const { w, advance } = rig(['match'], { refreshMs: 10_000, resolve: async () => (bound ? target : null) })
  await w.start('app.example.com')
  bound = false
  advance(11_000)
  await w.tickNow()
  assert.equal(w.status().on, false)
  assert.match(w.status().stoppedBecause ?? '', /no release binds/i)
})

test('a failed alert is retried on the next checks while the verdict stays flipped, up to 3 attempts', async () => {
  let attempts = 0
  const { w, advance } = rig(['match', 'mismatch'], { onFlip: async () => { if (++attempts < 3) throw new Error('arkiv down') } })
  await w.start('app.example.com')
  for (let n = 0; n < 4; n++) {
    advance(5000)
    await w.tickNow()
  }
  assert.equal(attempts, 3)
  assert.equal(w.status().flips.length, 1) // one flip, retried, not three flips
  assert.equal(w.status().flips[0].alert, 'done')
})

test('a flip write that hangs times out after the limit and the retry then finishes the alert', async () => {
  let calls = 0
  const { w, advance } = rig(['match', 'mismatch'], {
    flipTimeoutMs: 30,
    onFlip: () => (++calls === 1 ? new Promise<void>(() => {}) : Promise.resolve()), // the first write never finishes
  })
  await w.start('app.example.com')
  advance(5000)
  await w.tickNow() // flip seen, the write hangs: it must not hold the watcher past the limit
  assert.equal(w.status().flips[0].alert, 'failed')
  assert.match(w.status().flips[0].note ?? '', /did not finish in/i)
  advance(5000)
  await w.tickNow() // still flipped and failed: the retry runs and succeeds
  assert.equal(calls, 2)
  assert.equal(w.status().flips[0].alert, 'done')
})

test('a fast flip write is unchanged by the limit', async () => {
  const { w, advance } = rig(['match', 'mismatch'], { flipTimeoutMs: 1000 })
  await w.start('app.example.com')
  advance(5000)
  await w.tickNow()
  assert.equal(w.status().flips[0].alert, 'done')
})

test('three failed attempts end as failed and stop trying', async () => {
  let attempts = 0
  const { w, advance } = rig(['match', 'mismatch'], { onFlip: async () => { attempts++; throw new Error('arkiv down') } })
  await w.start('app.example.com')
  for (let n = 0; n < 8; n++) {
    advance(5000)
    await w.tickNow()
  }
  assert.equal(attempts, 3)
  assert.equal(w.status().flips[0].alert, 'failed')
})

test('runOk: a Jina second-view outage is not a failed write or alert, any other error still is', async () => {
  const { runOk } = await import('../src/watch.ts')
  const jina = 'Jina second view failed 1 of 1 renders (HTTP 402: Jina credit is out). Runtime-only script origins ...'
  assert.equal(runOk({ sites: 1, errors: [jina] }), null)
  assert.match(runOk({ sites: 1, errors: [jina, 'batch 1 not written: nonce too low'] }) ?? '', /batch 1 not written/)
  assert.match(runOk({ sites: 1, errors: ['alert for hydra-demo-dapp.vercel.app not sent: Telegram HTTP 400'] }) ?? '', /not sent/)
})

test('runOk accepts a one-site run that saw the site and wrote cleanly, and names what went wrong otherwise', async () => {
  const { runOk } = await import('../src/watch.ts')
  assert.equal(runOk({ sites: 1, errors: [] }), null)
  assert.match(runOk({ sites: 0, errors: [] }) ?? '', /no target/i)
  assert.match(runOk({ sites: 1, errors: ['batch 1 not written: arkiv down'] }) ?? '', /batch 1 not written/)
})
