import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sitesView, type ObservationRow, type TargetInfo } from '../src/observations.ts'

const targets: TargetInfo[] = [
  { app: 'uniswap', domain: 'app.uniswap.org', category: 'dex' },
  { domain: 'curve.fi', category: 'dex' },
  { domain: 'never.example', category: 'lending' },
]

const body = (o: object) => `0x${Buffer.from(JSON.stringify(o)).toString('hex')}`
const obs = (domain: string, at: number, status: string, hash: string, extra: object = {}): ObservationRow => ({
  $key: `0x${domain.length.toString(16).padStart(64, '0')}`,
  $expiresAt: 9_000_000,
  domain,
  status,
  observed_at: String(at),
  scripts_hash: hash,
  body: body({ scripts: [{ url: 'a', sha256: 'x' }, { url: 'b', sha256: 'y' }], problems: [], changed: false, via: 'direct', runtime_origins: [], ...extra }),
})

test('sitesView: every target is listed, newest observation first, unobserved targets are pending', () => {
  const v = sitesView(targets, [
    obs('app.uniswap.org', 100, 'unknown', 'h1'),
    obs('app.uniswap.org', 200, 'unknown', 'h2', { changed: true, runtime_origins: ['https://x.example'] }),
    obs('curve.fi', 200, 'mismatch', 'h3', { problems: ['CHANGED /a.js'] }),
  ])
  assert.deepEqual(v.sites.map((s) => s.domain), ['app.uniswap.org', 'curve.fi', 'never.example'])
  const uni = v.sites[0]
  assert.equal(uni.latest?.observed_at, 200)
  assert.equal(uni.latest?.scripts, 2)
  assert.deepEqual(uni.latest?.runtime_origins, ['https://x.example'])
  assert.equal(uni.latest?.changed, true)
  assert.equal(uni.history.length, 2)
  assert.equal(uni.history[0].observed_at, 200) // newest first
  assert.equal(v.sites[2].latest, null)
  assert.equal(v.sites[2].state, 'pending')
})

test('sitesView: summary counts states, categories and the last run time', () => {
  const v = sitesView(targets, [
    obs('app.uniswap.org', 200, 'match', 'h1'),
    obs('curve.fi', 200, 'mismatch', 'h3'),
  ])
  assert.deepEqual(v.summary.states, { match: 1, mismatch: 1, unknown: 0, pending: 1 })
  assert.deepEqual(v.summary.categories, { dex: 2, lending: 1 })
  assert.equal(v.summary.lastRun, 200)
  assert.equal(v.summary.sites, 3)
})

test('sitesView: a domain seen in rows but not in targets is listed; category falls back to the newest body, then other', () => {
  const bad = obs('curve.fi', 300, 'unknown', 'h4')
  bad.body = '0xzz'
  const v = sitesView(targets, [
    obs('stranger.example', 100, 'match', 'h8', { category: 'old' }),
    obs('stranger.example', 999, 'match', 'h9', { category: 'nft' }),
    obs('plain.example', 50, 'unknown', 'h5'),
    bad,
  ])
  const by = (d: string) => v.sites.find((s) => s.domain === d)!
  assert.equal(by('stranger.example').category, 'nft')
  assert.equal(by('plain.example').category, 'other')
  assert.equal(by('curve.fi').category, 'dex') // targets.json wins
  assert.equal(by('curve.fi').latest?.scripts, 0) // a bad body does not break the page
  assert.equal(v.summary.sites, 5)
  assert.equal(v.summary.lastRun, 999)
})

test('sitesView: history is newest first and capped at 8 per site', () => {
  const rows = Array.from({ length: 12 }, (_, i) => obs('curve.fi', 100 + i, 'match', `h${i}`))
  const h = sitesView(targets, rows).sites.find((s) => s.domain === 'curve.fi')!.history
  assert.equal(h.length, 8)
  assert.equal(h[0].observed_at, 111)
})
