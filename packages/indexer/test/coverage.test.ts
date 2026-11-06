import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldWrite, topTargets } from '../src/coverage.ts'

const P = [
  { name: 'Small', url: 'https://small.fi', tvl: 5, category: 'Dexs' },
  { name: 'Big', url: 'https://App.Big.xyz/swap?x=1', tvl: 900, category: 'Lending' },
  { name: 'NoUrl', url: '', tvl: 1000, category: 'Dexs' },
  { name: 'Bad', url: 'not a url', tvl: 800, category: 'Dexs' },
  { name: 'Ftp', url: 'ftp://x.com', tvl: 700, category: 'Dexs' },
  { name: 'Dup', url: 'http://app.big.xyz', tvl: 600, category: 'Dexs' },
  { name: 'Mid', url: 'https://mid.org/', tvl: 50, category: null },
  { name: 'Listed', url: 'https://listed.com', tvl: 999, category: 'Dexs' },
]

test('topTargets keeps listed first, then highest TVL unique hostnames', () => {
  const out = topTargets(P, 2, [{ domain: 'listed.com', category: 'dex' }])
  assert.deepEqual(out, [
    { domain: 'listed.com', category: 'dex' },
    { domain: 'app.big.xyz', category: 'lending' },
    { domain: 'mid.org', category: 'other' },
  ])
})

test('topTargets skips missing, invalid and non-http urls and tolerates junk input', () => {
  assert.deepEqual(topTargets([{ url: 'ftp://a.com', tvl: 1 }, { tvl: 2 }, null as never, { url: 'https://ok.io', tvl: 'x' as never }], 5, []),
    [{ domain: 'ok.io', category: 'other' }])
  assert.deepEqual(topTargets('nope' as never, 5, []), [])
})

const prev = { status: 'match', scripts_hash: 'h1', problems: ['B', 'A'], observed_at: 1_000 }
const DAY = 86_400_000
test('shouldWrite writes on first sight, any change, or a stale heartbeat', () => {
  assert.equal(shouldWrite(null, { status: 'match', scripts_hash: 'h1', problems: [] }, 2_000), true)
  assert.equal(shouldWrite(prev, { status: 'match', scripts_hash: 'h1', problems: ['A', 'B'] }, 2_000), false)
  assert.equal(shouldWrite(prev, { status: 'mismatch', scripts_hash: 'h1', problems: ['A', 'B'] }, 2_000), true)
  assert.equal(shouldWrite(prev, { status: 'match', scripts_hash: 'h2', problems: ['A', 'B'] }, 2_000), true)
  assert.equal(shouldWrite(prev, { status: 'match', scripts_hash: 'h1', problems: ['A'] }, 2_000), true)
  assert.equal(shouldWrite(prev, { status: 'match', scripts_hash: 'h1', problems: ['A', 'B'] }, 1_000 + DAY), true)
  assert.equal(shouldWrite(prev, { status: 'match', scripts_hash: 'h1', problems: ['A', 'B'] }, 1_000 + DAY - 1), false)
})

test('shouldWrite compares problems by code, not by the varying detail', () => {
  const p = { status: 'match', scripts_hash: 'h1', problems: ['TRUNCATED 713 scripts, checked 60'], observed_at: 1_000 }
  assert.equal(shouldWrite(p, { status: 'match', scripts_hash: 'h1', problems: ['TRUNCATED 714 scripts, checked 60'] }, 2_000), false)
  assert.equal(shouldWrite(p, { status: 'match', scripts_hash: 'h1', problems: ['TRUNCATED 713 scripts', 'UNREACHABLE x'] }, 2_000), true)
  assert.equal(shouldWrite(p, { status: 'match', scripts_hash: 'h1', problems: ['UNREACHABLE x'] }, 2_000), true)
})

test('scriptHash: an HTML page served at a script URL is unreadable, not a changing script', async () => {
  const { scriptHash } = await import('../src/scan.ts')
  const enc = (s: string) => new TextEncoder().encode(s)
  assert.equal(scriptHash(enc('  \n<!DOCTYPE html><html>nonce-123')), null)
  assert.match(String(scriptHash(enc('console.log(1)'))), /^sha256-[0-9a-f]{64}$/)
})

test('onlyTargets keeps just the named domains, case-insensitively, and an empty spec keeps all', async () => {
  const { onlyTargets } = await import('../src/coverage.ts')
  const t = [{ domain: 'a.example.com' }, { domain: 'B.example.com' }, { domain: 'c.example.com' }]
  assert.deepEqual(onlyTargets(t, 'b.example.com, A.example.com'), [t[0], t[1]])
  assert.deepEqual(onlyTargets(t, ''), t)
  assert.deepEqual(onlyTargets(t, undefined), t)
  assert.deepEqual(onlyTargets(t, 'nope.example.com'), [])
})

test('topTargets skips exchanges and chains: not dApp frontends a user signs on', async () => {
  const { topTargets } = await import('../src/coverage.ts')
  const rows = [
    { url: 'https://www.binance.com', tvl: 900, category: 'CEX' },
    { url: 'https://cedefi.example', tvl: 800, category: 'CeDeFi' },
    { url: 'https://chain.example', tvl: 700, category: 'Chain' },
    { url: 'https://app.dex.example', tvl: 100, category: 'Dexs' },
  ]
  assert.deepEqual(topTargets(rows, 5, []).map((t) => t.domain), ['app.dex.example'])
})
