import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkSite } from '../src/check.ts'
import { sha256Tag } from '../src/scan.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const APP = 'console.log("app")'
const LIB = 'console.log("lib")'
const HTML = '<html><script src="/app.js"></script><script src="https://cdn.example.com/lib.js"></script></html>'
const manifest = { app: 'demo', version: '1', commit: 'c', domains: ['app.example.com'], files: { '/app.js': sha256Tag(APP) }, scripts: { 'https://cdn.example.com/lib.js': sha256Tag(LIB) } }
const target = { domain: 'app.example.com', app: 'demo', manifest }
const ok = { ok: true as const }

function site(files: Record<string, string | Error>, proof: unknown = ok) {
  const asked: string[] = []
  return {
    asked,
    deps: {
      get: async (url: string) => {
        asked.push(url)
        const v = files[url]
        if (v === undefined) throw new Error('HTTP 404')
        if (v instanceof Error) throw v
        return enc(v)
      },
      proof: async () => proof as never,
    },
  }
}
const pages = { 'https://app.example.com/': HTML, 'https://app.example.com/app.js': APP, 'https://cdn.example.com/lib.js': LIB }

test('a site that serves exactly the release is a match', async () => {
  const s = site(pages)
  const r = await checkSite(target, s.deps)
  assert.deepEqual({ verdict: r.verdict, problems: r.problems, scripts: r.scripts }, { verdict: 'match', problems: [], scripts: 2 })
  assert.ok(r.ms >= 0)
})

test('a changed script is a mismatch that names the file', async () => {
  const r = await checkSite(target, site({ ...pages, 'https://app.example.com/app.js': APP + '\nconsole.warn(1)' }).deps)
  assert.equal(r.verdict, 'mismatch')
  assert.deepEqual(r.problems, ['CHANGED /app.js'])
})

test('a script in no release is a mismatch', async () => {
  const html = HTML.replace('</html>', '<script src="/evil.js"></script></html>')
  const r = await checkSite(target, site({ ...pages, 'https://app.example.com/': html, 'https://app.example.com/evil.js': 'x' }).deps)
  assert.equal(r.verdict, 'mismatch')
  assert.deepEqual(r.problems, ['EXTRA /evil.js'])
})

test('a lost proof is a mismatch, a proof that only could not be read is not', async () => {
  const lost = await checkSite(target, site(pages, { ok: false, reason: 'HTTP 404 for /.well-known/hydra.txt' }).deps)
  assert.equal(lost.verdict, 'mismatch')
  assert.match(lost.problems[0], /^DOMAIN_PROOF_LOST/)
  const blip = await checkSite(target, site(pages, { ok: false, transient: true, reason: 'timed out' }).deps)
  assert.equal(blip.verdict, 'match')
})

test('a page or a script that cannot be fetched is unreachable, never a mismatch', async () => {
  const down = await checkSite(target, site({}).deps)
  assert.equal(down.verdict, 'unreachable')
  const noScript = await checkSite(target, site({ ...pages, 'https://app.example.com/app.js': new Error('timed out') }).deps)
  assert.equal(noScript.verdict, 'unreachable')
  assert.match(noScript.problems.join(' '), /UNREADABLE/)
})

test('a script the site now answers with 404 is a mismatch (it was removed), a timeout is only unreachable', async () => {
  const gone = await checkSite(target, site({ 'https://app.example.com/': HTML, 'https://cdn.example.com/lib.js': LIB }).deps) // /app.js missing: HTTP 404
  assert.equal(gone.verdict, 'mismatch')
  assert.match(gone.problems.join(' '), /UNREADABLE \/app\.js/)
  const slow = await checkSite(target, site({ ...pages, 'https://app.example.com/app.js': new Error('timed out after 4 s') }).deps)
  assert.equal(slow.verdict, 'unreachable')
})

test('it reads at most 60 scripts', async () => {
  const many = Array.from({ length: 80 }, (_, i) => `<script src="/s${i}.js"></script>`).join('')
  const files: Record<string, string> = { 'https://app.example.com/': `<html>${many}</html>` }
  for (let i = 0; i < 80; i++) files[`https://app.example.com/s${i}.js`] = 'x'
  const s = site(files)
  const r = await checkSite({ ...target, manifest: { ...manifest, files: {}, scripts: {} } }, s.deps)
  assert.equal(r.scripts, 60)
  assert.equal(s.asked.length, 61) // the page plus 60 scripts
})
