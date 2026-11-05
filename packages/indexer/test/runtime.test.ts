import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeProblems } from '../src/scan.ts'

const pageUrl = 'https://app.example.com/'
const raw = ['https://app.example.com/a.js', 'https://cdn.known.net/lib.js']

test('runtime origins: only third-party origins seen in the rendered page and not in the raw HTML', () => {
  const r = runtimeProblems({
    pageUrl,
    raw,
    rendered: [...raw, 'https://app.example.com/chunk-9.js', 'https://cdn.known.net/other.js', 'https://evil.example/d.js', 'https://evil.example/e.js'],
    manifest: null,
  })
  assert.deepEqual(r.origins, ['https://evil.example'])
})

test('runtime origins with a release: an origin the release does not list is RUNTIME_ORIGIN', () => {
  const r = runtimeProblems({
    pageUrl,
    raw,
    rendered: [...raw, 'https://www.googletagmanager.com/gtm.js', 'https://evil.example/d.js'],
    manifest: { files: {}, scripts: { 'https://www.googletagmanager.com/gtm.js?id=1': 'sha256-x' } },
  })
  assert.deepEqual(r.problems, ['RUNTIME_ORIGIN https://evil.example'])
})

test('runtime origins without a release: the first run is a baseline with 0 problems', () => {
  const r = runtimeProblems({ pageUrl, raw, rendered: [...raw, 'https://evil.example/d.js'], manifest: null })
  assert.deepEqual(r.problems, [])
})

test('runtime origins without a release: only origins new since the previous run are flagged', () => {
  const r = runtimeProblems({
    pageUrl,
    raw,
    rendered: [...raw, 'https://www.googletagmanager.com/gtm.js', 'https://evil.example/d.js'],
    manifest: null,
    previous: ['https://www.googletagmanager.com'],
  })
  assert.deepEqual(r.problems, ['NEW_RUNTIME_ORIGIN https://evil.example'])
})
