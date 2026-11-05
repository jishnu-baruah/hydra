import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compare, scriptUrls, scriptsHash } from '../src/scan.ts'

const ORIGIN = 'https://app.example.com/'

test('scriptUrls: src scripts and modulepreload links, resolved, deduped; inline scripts and stylesheets ignored', () => {
  const html = `<html><head>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" href="/assets/vendor-1.js">
    <link rel="stylesheet" href="/assets/index.css">
    <script src='https://cdn.example.net/lib.min.js' defer></script>
    <SCRIPT SRC=/assets/index-abc.js></SCRIPT>
    <script>self.__next_f.push([1,"x"])</script>
  </head></html>`
  assert.deepEqual(scriptUrls(html, ORIGIN), [
    'https://app.example.com/assets/index-abc.js',
    'https://app.example.com/assets/vendor-1.js',
    'https://cdn.example.net/lib.min.js',
  ])
})

test('scriptUrls: javascript: and data: URLs are not fetched', () => {
  assert.deepEqual(scriptUrls('<script src="javascript:alert(1)"></script><script src="data:text/javascript,1"></script>', ORIGIN), [])
})

const manifest = {
  files: { '/index.html': 'sha256-h', '/assets/index-abc.js': 'sha256-a' },
  scripts: { 'https://cdn.example.net/lib.min.js': 'sha256-c' },
}

test('compare: every script in the release is a match', () => {
  const r = compare(ORIGIN, [
    { url: 'https://app.example.com/assets/index-abc.js', sha256: 'sha256-a' },
    { url: 'https://cdn.example.net/lib.min.js', sha256: 'sha256-c' },
  ], manifest)
  assert.deepEqual(r, { status: 'match', problems: [] })
})

test('compare: a 1-byte change is CHANGED, a foreign script is EXTRA, both make a mismatch', () => {
  const r = compare(ORIGIN, [
    { url: 'https://app.example.com/assets/index-abc.js', sha256: 'sha256-a2' },
    { url: 'https://cdn.evil.example/x.js', sha256: 'sha256-e' },
  ], manifest)
  assert.equal(r.status, 'mismatch')
  assert.deepEqual(r.problems, ['CHANGED /assets/index-abc.js', 'EXTRA https://cdn.evil.example/x.js'])
})

test('compare: no release means unknown, never match', () => {
  assert.deepEqual(compare(ORIGIN, [{ url: 'https://app.example.com/a.js', sha256: 'sha256-a' }], null), { status: 'unknown', problems: [] })
})

test('compare: a script that could not be fetched is a mismatch, not a silent pass', () => {
  const r = compare(ORIGIN, [{ url: 'https://app.example.com/assets/index-abc.js', sha256: null }], manifest)
  assert.deepEqual(r, { status: 'mismatch', problems: ['UNREADABLE /assets/index-abc.js'] })
})

test('scriptsHash: order-independent, changes when any script changes', () => {
  const a = [{ url: 'u1', sha256: 's1' }, { url: 'u2', sha256: 's2' }]
  assert.equal(scriptsHash(a), scriptsHash([...a].reverse()))
  assert.notEqual(scriptsHash(a), scriptsHash([{ url: 'u1', sha256: 's1' }, { url: 'u2', sha256: 's3' }]))
})
