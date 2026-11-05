import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { keyFromSignature, signInMessage } from '../src/auth.ts'
import { issueKey, verifyKey } from '../src/keys.ts'
import { createApi } from '../src/server.ts'
import { tar } from '../src/tar.ts'

const SECRET = 'x'.repeat(40)
const account = privateKeyToAccount(generatePrivateKey())

test('keys: a key verifies, and a tampered or foreign one does not', () => {
  const key = issueKey(SECRET, { address: account.address, app: 'demo', iat: 1 })
  assert.deepEqual(verifyKey(SECRET, key), { address: account.address, app: 'demo', iat: 1 })
  assert.equal(verifyKey('y'.repeat(40), key), null)
  const [body, mac] = key.slice(4).split('.')
  const forged = Buffer.from(JSON.stringify({ address: account.address, app: 'other', iat: 1 })).toString('base64url')
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

// End-to-end through HTTP with fake Arkiv and Swarm writers.
const calls = { one: 0, many: 0, swarm: 0, lastMany: 0 }
const server = createApi({
  secret: SECRET,
  publish: {
    createOne: async () => {
      calls.one++
      return { entityKey: `0x${'11'.repeat(32)}`, txHash: `0x${'22'.repeat(32)}` }
    },
    createMany: async (specs) => {
      calls.many++
      calls.lastMany = specs.length
      return { createdEntities: specs.map(() => `0x${'33'.repeat(32)}` as const), txHash: `0x${'44'.repeat(32)}` }
    },
    swarm: async (files) => {
      calls.swarm++
      assert.ok(files.some((f) => f.path === 'hydra-manifest.json'))
      return 'ab'.repeat(32)
    },
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

test('publish: a valid key uploads to Swarm once, writes 1 release and 1 batch of 2 code files', async () => {
  const key = issueKey(SECRET, { address: account.address, app: 'demo', iat: 1 })
  const { status, json } = await post('/v1/releases', build, key)
  assert.equal(status, 201, JSON.stringify(json))
  assert.equal(json.swarmRef, 'ab'.repeat(32))
  assert.equal(json.publisher, account.address)
  assert.equal(json.filesIndexed, 2) // index.html and app.js; logo.png is not code
  assert.deepEqual([calls.one, calls.many, calls.swarm, calls.lastMany], [1, 1, 1, 2])
})

test('publish: path traversal and a build without index.html are refused with 0 new writes', async () => {
  const key = issueKey(SECRET, { address: account.address, app: 'demo', iat: 1 })
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
