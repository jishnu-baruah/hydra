import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { AppSchema, LEASE, LONG } from '@hydra/core'
import { keyFromSignature, signInMessage } from '../src/auth.ts'
import { issueKey, verifyKey } from '../src/keys.ts'
import { createApi, indexerRunner } from '../src/server.ts'
import { swarmUploader } from '../src/swarm.ts'
import { tar } from '../src/tar.ts'

const SECRET = 'x'.repeat(40)
const account = privateKeyToAccount(generatePrivateKey())
const intruder = privateKeyToAccount(generatePrivateKey())
const FAR = Date.parse('2100-01-01T00:00:00Z')
const keyFor = (address: string, app = 'demo', exp = FAR) => issueKey(SECRET, { address, app, iat: 1, exp })

test('keys: a key verifies, and a tampered or foreign one does not', () => {
  const key = keyFor(account.address)
  assert.deepEqual(verifyKey(SECRET, key), { address: account.address, app: 'demo', iat: 1, exp: FAR })
  assert.equal(verifyKey(SECRET, keyFor(account.address, 'demo', Date.now() - 1)), null) // expired
  assert.equal(verifyKey('y'.repeat(40), key), null)
  const [body, mac] = key.slice(4).split('.')
  const forged = Buffer.from(JSON.stringify({ address: account.address, app: 'other', iat: 1, exp: FAR })).toString('base64url')
  assert.equal(verifyKey(SECRET, `hyd_${forged}.${mac}`), null)
  assert.equal(verifyKey(SECRET, `hyd_${body}.`), null)
  assert.equal(verifyKey(SECRET, 'garbage'), null)
})

test('sign-in: a fresh signature earns a key; a wrong signer or a stale time does not', async () => {
  const issuedAt = new Date().toISOString()
  const signature = await account.signMessage({ message: signInMessage(account.address, 'demo', issuedAt) })
  const ok = await keyFromSignature(SECRET, { address: account.address, app: 'demo', issuedAt, signature })
  assert.ok(ok.ok)
  assert.equal(verifyKey(SECRET, ok.value.apiKey)?.app, 'demo')

  const other = privateKeyToAccount(generatePrivateKey())
  const wrong = await keyFromSignature(SECRET, { address: other.address, app: 'demo', issuedAt, signature })
  assert.equal(!wrong.ok && wrong.status, 401)

  const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString()
  const staleSig = await account.signMessage({ message: signInMessage(account.address, 'demo', stale) })
  const late = await keyFromSignature(SECRET, { address: account.address, app: 'demo', issuedAt: stale, signature: staleSig })
  assert.equal(!late.ok && late.status, 400)
})

test('tar: system tar lists and extracts what we wrote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-tar-'))
  const file = join(dir, 'b.tar')
  writeFileSync(file, tar([
    { path: 'index.html', data: Buffer.from('<h1>hi</h1>') },
    { path: 'assets/app.js', data: Buffer.from('x'.repeat(700)) },
  ]))
  const cwd = { cwd: dir }
  assert.deepEqual(execFileSync('tar', ['-tf', 'b.tar'], cwd).toString().trim().split(/\r?\n/), ['index.html', 'assets/app.js'])
  assert.equal(execFileSync('tar', ['-xOf', 'b.tar', 'assets/app.js'], cwd).toString().length, 700)
})

// End-to-end through HTTP with fake Arkiv and Swarm writers. App claims land in `owners`.
const calls = { one: 0, many: 0, swarm: 0, proofs: 0, lastMany: 0, lastExt: [] as unknown[], claimExp: undefined as unknown }
let lastManifest: { domains: string[] } | undefined
const owners = new Map<string, string>()
const server = createApi({
  secret: SECRET,
  claimOf: async (app) => (owners.has(app) ? { owner: owners.get(app)!, key: `0x${'aa'.repeat(32)}` as const } : null),
  publish: {
    createOne: async (spec) => {
      calls.one++
      if (spec.schema === AppSchema) {
        owners.set(String(spec.values.app), String(spec.values.publisher))
        calls.claimExp = spec.expiration
      }
      return { entityKey: `0x${'11'.repeat(32)}`, txHash: `0x${'22'.repeat(32)}` }
    },
    createMany: async (specs, extensions = []) => {
      calls.many++
      calls.lastMany = specs.length
      calls.lastExt = extensions
      return { createdEntities: specs.map(() => `0x${'33'.repeat(32)}` as const), txHash: `0x${'44'.repeat(32)}` }
    },
    swarm: async (files) => {
      calls.swarm++
      const m = files.find((f) => f.path === 'hydra-manifest.json')
      assert.ok(m)
      lastManifest = JSON.parse(m.data.toString())
      return 'ab'.repeat(32)
    },
    // Stub proof: only hosts starting with "good." serve the proof file.
    proveDomain: async (d, _app) => (calls.proofs++, d.startsWith('good.') ? { ok: true } : { ok: false, reason: `${d} serves no hydra.txt` }),
    now: () => Date.parse('2026-11-06T10:00:00Z'),
  },
})
server.listen(0)
after(() => server.close())
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const b64 = (s: string) => Buffer.from(s).toString('base64')
const build = { files: { '/index.html': b64('<script src="/app.js"></script>'), '/app.js': b64('console.log(1)'), '/logo.png': b64('png') }, commit: 'abc1234def', ciRunUrl: 'https://github.com/x/y/actions/runs/1' }

async function post(path: string, body: unknown, key?: string) {
  const res = await fetch(base() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

test('publish: no key or a bad key gets 401 with 0 writes', async () => {
  assert.equal((await post('/v1/releases', build)).status, 401)
  assert.equal((await post('/v1/releases', build, 'hyd_bad.key')).status, 401)
  assert.deepEqual([calls.one, calls.many, calls.swarm], [0, 0, 0])
})

test('publish: the first publish claims the app, uploads to Swarm once, writes 1 release and 1 batch of 2 code files', async () => {
  const { status, json } = await post('/v1/releases', { ...build, domains: ['good.example.com', 'Bad.Example.com'] }, keyFor(account.address))
  assert.equal(status, 201, JSON.stringify(json))
  assert.equal(json.swarmRef, 'ab'.repeat(32))
  assert.equal(json.publisher, account.address)
  assert.equal(json.filesIndexed, 2) // index.html and app.js; logo.png is not code
  assert.deepEqual(json.domains, ['good.example.com'])
  assert.deepEqual(json.domainsUnverified, [{ domain: 'bad.example.com', reason: 'bad.example.com serves no hydra.txt' }])
  assert.deepEqual(lastManifest?.domains, ['good.example.com']) // only the proven domain reaches the manifest
  assert.ok(json.appClaimTx)
  assert.equal(owners.get('demo'), account.address.toLowerCase())
  // 2 single writes (app claim, release), 1 batch
  assert.deepEqual([calls.one, calls.many, calls.swarm, calls.lastMany], [2, 1, 1, 2])
})

test('publish: a bad domain or more than 5 domains is a 400 with 0 writes and 0 proof fetches', async () => {
  const before = { ...calls }
  const key = keyFor(account.address)
  assert.equal((await post('/v1/releases', { ...build, domains: ['good.example.com', 'localhost'] }, key)).status, 400)
  assert.equal((await post('/v1/releases', { ...build, domains: Array.from({ length: 6 }, (_, i) => `good${i}.example.com`) }, key)).status, 400)
  assert.equal((await post('/v1/releases', { ...build, domains: 'good.example.com' }, key)).status, 400)
  assert.deepEqual(calls, before)
})

test('ownership: another address cannot get a key for, or publish to, an owned app (0 writes)', async () => {
  const before = { ...calls }
  const pub = await post('/v1/releases', { ...build, domains: ['good.example.com'] }, keyFor(intruder.address))
  assert.equal(pub.status, 403)
  assert.equal(calls.proofs, before.proofs) // a rival's publish triggers no proof fetch
  const msg = await (await fetch(`${base()}/v1/auth/message?address=${intruder.address}&app=demo`)).json() as { message: string; issuedAt: string }
  const signature = await intruder.signMessage({ message: msg.message })
  const key = await post('/v1/auth/key', { address: intruder.address, app: 'demo', issuedAt: msg.issuedAt, signature })
  assert.equal(key.status, 403)
  assert.equal(key.json.apiKey, undefined)
  assert.deepEqual(calls, before)
})

test('spend limits: allowlist and per-address publish rate', async () => {
  let writes = 0
  const fake = async () => (writes++, { entityKey: `0x${'11'.repeat(32)}` as const, txHash: `0x${'22'.repeat(32)}` as const })
  const limited = createApi({
    secret: SECRET,
    allowedAddresses: new Set([account.address.toLowerCase()]),
    publishesPerHour: 1,
    publish: { createOne: fake, createMany: async () => ({ createdEntities: [], txHash: `0x${'44'.repeat(32)}` }) },
  }).listen(0)
  try {
    const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/v1/releases`
    const go = (key: string) => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(build) }).then((r) => r.status)
    assert.equal(await go(keyFor(intruder.address)), 403)
    assert.equal(await go(keyFor(account.address)), 201)
    assert.equal(await go(keyFor(account.address)), 429)
    assert.equal(writes, 1) // only the one allowed release
  } finally {
    limited.close()
  }
})

test('publish: path traversal and a build without index.html are refused with 0 new writes', async () => {
  const key = keyFor(account.address)
  const before = calls.one
  const evil = await post('/v1/releases', { files: { '/index.html': b64('x'), '/../etc/passwd': b64('x') } }, key)
  assert.equal(evil.status, 400)
  const noIndex = await post('/v1/releases', { files: { '/app.js': b64('x') } }, key)
  assert.equal(noIndex.status, 400)
  assert.equal(calls.one, before)
})

test('auth routes: message, then key, over HTTP', async () => {
  const msg = await (await fetch(`${base()}/v1/auth/message?address=${account.address}&app=demo`)).json() as { message: string; issuedAt: string }
  const signature = await account.signMessage({ message: msg.message })
  const { status, json } = await post('/v1/auth/key', { address: account.address, app: 'demo', issuedAt: msg.issuedAt, signature })
  assert.equal(status, 200)
  assert.equal(verifyKey(SECRET, json.apiKey as string)?.address, account.address)
})

test('reserve at key time: a key claims its unowned name once; another wallet is refused before any publish', async () => {
  const getKey = async (who: typeof account, app: string) => {
    const msg = await (await fetch(`${base()}/v1/auth/message?address=${who.address}&app=${app}`)).json() as { message: string; issuedAt: string }
    const signature = await who.signMessage({ message: msg.message })
    return post('/v1/auth/key', { address: who.address, app, issuedAt: msg.issuedAt, signature })
  }
  const before = calls.one
  const first = await getKey(account, 'fresh-app')
  assert.equal(first.status, 200)
  assert.ok(first.json.claimTx)
  assert.equal(owners.get('fresh-app'), account.address.toLowerCase())
  assert.equal(calls.one, before + 1) // exactly 1 claim write

  const again = await getKey(account, 'fresh-app') // the owner asking again: no second claim
  assert.equal(again.status, 200)
  assert.equal(again.json.claimTx, null)

  const rival = await getKey(intruder, 'fresh-app')
  assert.equal(rival.status, 403)
  assert.match(String(rival.json.error), /get a new key on the Hydra site/)

  const pub = await post('/v1/releases', build, first.json.apiKey as string)
  assert.equal(pub.status, 201)
  assert.equal(pub.json.appClaimTx, null) // already claimed at key time
  assert.equal(calls.one, before + 2) // + the release write only
  // The claim is a 30-day lease; the publish renews it to LONG inside the file batch.
  assert.deepEqual(calls.claimExp, LEASE())
  assert.equal(pub.json.leaseRenewed, true)
  assert.deepEqual(calls.lastExt, [{ entityKey: `0x${'aa'.repeat(32)}`, expiration: LONG() }])
})

test('indexer trigger: wrong secret 401, 202 and runs in the background, one at a time, then rate limited', async () => {
  let runs = 0
  let release: () => void = () => {}
  const srv = createApi({
    secret: SECRET,
    indexer: { secret: 'k'.repeat(40), run: () => new Promise((r) => { runs++; release = () => r({ sites: 3, written: 20, txs: [], errors: [], lines: ['l'], ms: 5 }) }) },
  }).listen(0)
  try {
    const root = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
    const hit = (secret: string) => fetch(`${root}/v1/indexer/run`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } })
    const status = async () => (await (await fetch(`${root}/v1/indexer/status`)).json()) as { running: boolean; startedAt: number | null; finishedAt: number | null; last: { written: number } | null }
    assert.equal((await hit('wrong')).status, 401)
    assert.deepEqual(await status(), { running: false, startedAt: null, finishedAt: null, last: null })
    const first = await hit('k'.repeat(40))
    assert.equal(first.status, 202) // returns before the run ends
    const startedAt = ((await first.json()) as { started: boolean; startedAt: number }).startedAt
    assert.ok(startedAt > 0)
    assert.equal((await hit('k'.repeat(40))).status, 409) // still running
    const mid = await status()
    assert.equal(mid.running, true)
    assert.equal(mid.startedAt, startedAt)
    release()
    await new Promise((r) => setTimeout(r, 50))
    const done = await status()
    assert.equal(done.running, false)
    assert.ok((done.finishedAt ?? 0) >= startedAt)
    assert.equal(done.last?.written, 20)
    assert.equal((await hit('k'.repeat(40))).status, 429) // under 5 minutes since the last run
    assert.equal(runs, 1)
  } finally {
    srv.close()
  }
})

test('indexer trigger: a run that throws is recorded in status as an error, without a stack', async () => {
  const srv = createApi({ secret: SECRET, indexer: { secret: 'k'.repeat(40), run: async () => { throw new Error('arkiv down') } } }).listen(0)
  try {
    const root = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
    assert.equal((await fetch(`${root}/v1/indexer/run`, { method: 'POST', headers: { Authorization: `Bearer ${'k'.repeat(40)}` } })).status, 202)
    await new Promise((r) => setTimeout(r, 50))
    const st = (await (await fetch(`${root}/v1/indexer/status`)).json()) as { running: boolean; finishedAt: number | null; last: { errors: string[] } }
    assert.equal(st.running, false)
    assert.ok(st.finishedAt)
    assert.match(st.last.errors[0], /arkiv down/)
    assert.doesNotMatch(st.last.errors[0], /\n\s+at /)
  } finally {
    srv.close()
  }
})

test('indexer runner: one guard serves the route and the timer', async () => {
  const r = indexerRunner(async () => ({ sites: 1, written: 1, txs: [], errors: [], lines: [], ms: 1 }))
  assert.equal(r.start().ok, true)
  assert.equal(r.start().ok, false) // busy
  await new Promise((x) => setTimeout(x, 20))
  const b = r.start()
  assert.equal(!b.ok && b.status, 429)
})

test('swarm: the batch header is sent only when a batch id is set (gateway mode stamps for us)', async () => {
  const real = globalThis.fetch
  const seen: Headers[] = []
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers))
    return new Response(JSON.stringify({ reference: 'ab'.repeat(32) }), { status: 201 })
  }) as typeof fetch
  try {
    const files = [{ path: 'index.html', data: new TextEncoder().encode('x') }]
    await swarmUploader({ beeUrl: 'https://gw.test' })(files)
    await swarmUploader({ beeUrl: 'https://gw.test', batchId: 'cd'.repeat(32) })(files)
  } finally {
    globalThis.fetch = real
  }
  assert.equal(seen[0].has('swarm-postage-batch-id'), false)
  assert.equal(seen[1].get('swarm-postage-batch-id'), 'cd'.repeat(32))
})

test('observations route is served when a reader is configured and absent otherwise', async () => {
  const srv = createApi({ secret: SECRET, observations: async () => ({ summary: { sites: 1 }, sites: [{ domain: 'a.example' }] }) }).listen(0)
  const bare = createApi({ secret: SECRET }).listen(0)
  try {
    const get = (s: typeof srv) => fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/v1/observations`)
    const ok = await get(srv)
    assert.equal(ok.status, 200)
    assert.equal(((await ok.json()) as { sites: unknown[] }).sites.length, 1)
    assert.equal((await get(bare)).status, 404)
  } finally {
    srv.close()
    bare.close()
  }
})

test('domain route: names the app for a hostname, rejects junk, and is absent without a reader', async () => {
  const seen: string[] = []
  const api = createApi({ secret: SECRET, appForDomain: async (d) => (seen.push(d), d === 'app.example.com' ? 'alpha' : null) })
  const server = api.listen(0)
  after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const ok = await fetch(`${base}/v1/domains/App.Example.com`)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { domain: 'app.example.com', app: 'alpha' })
  assert.deepEqual(await (await fetch(`${base}/v1/domains/unknown.example.com`)).json(), { domain: 'unknown.example.com', app: null })
  for (const bad of ['localhost', '127.0.0.1', 'a_b.com', 'x'.repeat(300) + '.com']) {
    assert.equal((await fetch(`${base}/v1/domains/${bad}`)).status, 400, bad)
  }
  assert.deepEqual(seen, ['app.example.com', 'unknown.example.com']) // junk never reaches the reader
  const bare = createApi({ secret: SECRET }).listen(0)
  after(() => bare.close())
  assert.equal((await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/v1/domains/app.example.com`)).status, 404)
})

