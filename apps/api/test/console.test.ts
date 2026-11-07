import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { consoleMessage, issueSession, verifySession } from '../src/console.ts'
import { issueKey, verifyKey } from '../src/keys.ts'
import { keyFromSignature, signInMessage } from '../src/auth.ts'
import { createApi } from '../src/server.ts'
import type { AlertRoutes } from '../src/server.ts'
import type { StoredSub } from '../src/alerts.ts'

const SECRET = 'x'.repeat(40)
const FAR = Date.parse('2100-01-01T00:00:00Z')
const me = privateKeyToAccount(generatePrivateKey())
const other = privateKeyToAccount(generatePrivateKey())
const ME = me.address.toLowerCase()

// Fakes: apps and owners, key versions, alert rows. Nothing touches a network.
const owners = new Map<string, string>([['mine', ME], ['mine2', ME], ['theirs', other.address.toLowerCase()]])
const versions = new Map<string, number>()
const rotated: string[] = []
const rows: (StoredSub & { app: string })[] = []
const alerts: AlertRoutes = {
  key: 'ab'.repeat(32),
  store: {
    list: async (app) => rows.filter((r) => r.app === app),
    create: async (app, kind, sealed, createdAt) => {
      const id = `0x${(rows.length + 1).toString(16).padStart(64, '0')}`
      rows.push({ id, app, kind, created_at: createdAt, sealed })
      return { id }
    },
    remove: async (id) => void rows.splice(rows.findIndex((r) => r.id === id), 1),
  },
  deliver: async () => ({ ok: true }),
  telegramChats: async () => [{ id: '-1000', title: 'chat' }],
  writesPerHour: 100,
}
const build = (extra: object = {}) =>
  createApi({
    secret: SECRET,
    claimOf: async (app) => (owners.has(app) ? { owner: owners.get(app)!, key: `0x${'aa'.repeat(32)}` as const } : null),
    keyVersion: async (app) => versions.get(app) ?? 0,
    console: {
      apps: async (address) =>
        [
          { app: 'mine', created_at: 5, expires_at: 9 },
          { app: 'mine2', created_at: 6, expires_at: 9 },
          { app: 'theirs', created_at: 7, expires_at: 9 }, // a stale candidate: the earliest claim is someone else's
        ].filter(() => address.toLowerCase() === ME),
      rotate: async (app) => {
        rotated.push(app)
        const version = (versions.get(app) ?? 0) + 1
        versions.set(app, version)
        return { version }
      },
      rotationsPerHour: 3,
    },
    alerts,
    ...extra,
  }).listen(0)
const server = build()
after(() => server.close())
const origin = (s: typeof server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`
async function call(method: string, path: string, o: { token?: string; body?: unknown; srv?: typeof server } = {}) {
  const res = await fetch(origin(o.srv ?? server) + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}
async function login(account = me, srv = server) {
  const { json } = await call('GET', `/v1/console/message?address=${account.address}`, { srv })
  const signature = await account.signMessage({ message: json.message })
  return call('POST', '/v1/console/session', { srv, body: { address: account.address, issuedAt: json.issuedAt, signature } })
}

test('session message: exact text, lowercased address, 400 on a bad address', async () => {
  const { status, json } = await call('GET', `/v1/console/message?address=${me.address}`)
  assert.equal(status, 200)
  assert.equal(json.message, `Hydra console sign-in\nOnly sign this on https://hydra-registry.vercel.app/console/\nAddress: ${ME}\nIssued: ${json.issuedAt}`)
  assert.equal(new Date(json.issuedAt).toISOString(), json.issuedAt)
  assert.equal((await call('GET', '/v1/console/message?address=0x12')).status, 400)
  assert.equal((await call('GET', '/v1/console/message')).status, 400)
})

test('session: a valid signature earns a hys_ token; wrong signer 401; stale, future and malformed 400', async () => {
  const ok = await login()
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.match(ok.json.session, /^hys_/)
  assert.equal(String(ok.json.address).toLowerCase(), ME)
  assert.ok(ok.json.expires > Date.now() + 119 * 60_000 && ok.json.expires <= Date.now() + 121 * 60_000)

  const at = new Date().toISOString()
  const sig = await me.signMessage({ message: consoleMessage(me.address, at) })
  const wrong = await call('POST', '/v1/console/session', { body: { address: other.address, issuedAt: at, signature: sig } })
  assert.equal(wrong.status, 401)
  assert.match(wrong.json.error, /signature/)

  for (const ms of [-11 * 60_000, 2 * 60_000]) {
    const t = new Date(Date.now() + ms).toISOString()
    const s = await me.signMessage({ message: consoleMessage(me.address, t) })
    assert.equal((await call('POST', '/v1/console/session', { body: { address: me.address, issuedAt: t, signature: s } })).status, 400, String(ms))
  }
  assert.equal((await call('POST', '/v1/console/session', { body: { address: me.address, issuedAt: at, signature: 'nothex' } })).status, 400)
  assert.equal((await call('POST', '/v1/console/session', { body: { address: 'x', issuedAt: at, signature: sig } })).status, 400)
  // The key sign-in message is a different text: its signature does not open a console session.
  const keySig = await me.signMessage({ message: signInMessage(me.address, 'mine', at) })
  assert.equal((await call('POST', '/v1/console/session', { body: { address: me.address, issuedAt: at, signature: keySig } })).status, 401)
})

test('session: the allowlist applies', async () => {
  const s = build({ allowedAddresses: new Set(['0x0000000000000000000000000000000000000001']) })
  const res = await login(me, s)
  assert.equal(res.status, 403)
  assert.match(res.json.error, /allowlisted/)
  s.close()
})

test('session tokens: tampered, expired, wrong secret, wrong scope and key tokens are refused', () => {
  const claims = { address: me.address, scope: 'console' as const, iat: 1, exp: FAR }
  const t = issueSession(SECRET, claims)
  assert.equal(verifySession(SECRET, t)?.address, me.address)
  assert.equal(verifySession('y'.repeat(40), t), null)
  assert.equal(verifySession(SECRET, issueSession(SECRET, { ...claims, exp: Date.now() - 1 })), null)
  assert.equal(verifySession(SECRET, issueSession(SECRET, { ...claims, scope: 'x' as never })), null)
  const [body, mac] = t.slice(4).split('.')
  const forged = Buffer.from(JSON.stringify({ ...claims, address: other.address })).toString('base64url')
  assert.equal(verifySession(SECRET, `hys_${forged}.${mac}`), null)
  // Domain separation: a key is not a session and a session is not a key, even with the same body.
  const key = issueKey(SECRET, claims as never)
  assert.equal(verifySession(SECRET, `hys_${key.slice(4)}`), null)
  assert.equal(verifyKey(SECRET, `hyd_${body}.${mac}`), null)
})

test('console routes: 401 without a session, with garbage, or with a hyd_ key', async () => {
  const key = issueKey(SECRET, { address: me.address, app: 'mine', iat: 1, exp: FAR })
  for (const [m, p] of [['GET', '/v1/console/apps'], ['POST', '/v1/console/apps/mine/rotate'], ['GET', '/v1/console/apps/mine/telegram-chats'], ['POST', '/v1/console/apps/mine/alerts']] as const) {
    assert.equal((await call(m, p)).status, 401, p)
    assert.equal((await call(m, p, { token: 'hys_bad.token' })).status, 401, p)
    assert.equal((await call(m, p, { token: key })).status, 401, p)
  }
  const expired = issueSession(SECRET, { address: me.address, scope: 'console', iat: 1, exp: Date.now() - 1 })
  assert.equal((await call('GET', '/v1/console/apps', { token: expired })).status, 401)
})

test('apps: lists only apps whose earliest claim is the session address, with channels and key_version', async () => {
  const { session } = (await login()).json
  versions.set('mine2', 2)
  assert.equal((await call('POST', '/v1/console/apps/mine/alerts', { token: session, body: { kind: 'telegram', target: '-1000' } })).status, 201)
  const { status, json } = await call('GET', '/v1/console/apps', { token: session })
  assert.equal(status, 200)
  assert.equal(String(json.address).toLowerCase(), ME)
  assert.deepEqual(json.apps.map((a: any) => a.app), ['mine', 'mine2'])
  assert.deepEqual(json.apps.map((a: any) => a.key_version), [0, 2])
  assert.equal(json.apps[0].created_at, 5)
  assert.equal(json.apps[0].expires_at, 9)
  assert.deepEqual(Object.keys(json.apps[0].channels[0]).sort(), ['created_at', 'id', 'kind', 'label'])
  assert.deepEqual(json.apps[1].channels, [])
  // Another wallet's session lists nothing of ours.
  const o = (await login(other)).json.session
  assert.deepEqual((await call('GET', '/v1/console/apps', { token: o })).json.apps, [])
  versions.delete('mine2')
})

test('apps: alerts being off does not fail the listing', async () => {
  const s = build({ alerts: undefined })
  const session = issueSession(SECRET, { address: me.address, scope: 'console', iat: Date.now(), exp: FAR })
  const r = await call('GET', '/v1/console/apps', { token: session, srv: s })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.apps[0].channels, [])
  s.close()
})

test('rotate: 403 for an app the session does not own; the owner gets a new key with the new version', async () => {
  const { session } = (await login()).json
  const before = rotated.length
  assert.equal((await call('POST', '/v1/console/apps/theirs/rotate', { token: session })).status, 403)
  assert.equal((await call('POST', '/v1/console/apps/unclaimed/rotate', { token: session })).status, 403)
  assert.equal(rotated.length, before)

  const r = await call('POST', '/v1/console/apps/mine/rotate', { token: session })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.app, 'mine')
  assert.equal(r.json.version, 1)
  const claims = verifyKey(SECRET, r.json.key)
  assert.equal(claims?.app, 'mine')
  assert.equal(claims?.address.toLowerCase(), ME)
  assert.equal(claims?.v, 1)
  assert.ok(claims && Math.abs(claims.exp - Date.now() - 30 * 86_400_000) < 60_000)
  assert.equal(r.json.expires_at, claims?.exp)
  versions.delete('mine')
})

test('rotate: at most 3 per app per hour in this test, and the refusal says when to retry', async () => {
  const { session } = (await login()).json
  const codes: number[] = []
  for (let i = 0; i < 4; i++) codes.push((await call('POST', '/v1/console/apps/mine2/rotate', { token: session })).status)
  assert.deepEqual(codes, [200, 200, 200, 429])
  assert.match((await call('POST', '/v1/console/apps/mine2/rotate', { token: session })).json.error, /hour/)
  versions.delete('mine2')
})

test('key versions: an older key is refused on releases and alerts; the current key and a v-less key at version 0 work', async () => {
  versions.set('mine', 2)
  const old = issueKey(SECRET, { address: me.address, app: 'mine', iat: 1, exp: FAR })
  const old1 = issueKey(SECRET, { address: me.address, app: 'mine', iat: 1, exp: FAR, v: 1 })
  const fresh = issueKey(SECRET, { address: me.address, app: 'mine', iat: 1, exp: FAR, v: 2 })
  for (const k of [old, old1]) {
    for (const [m, p] of [['POST', '/v1/releases'], ['GET', '/v1/alerts'], ['POST', '/v1/alerts'], ['GET', '/v1/alerts/telegram-chats']] as const) {
      const r = await call(m, p, { token: k, body: m === 'POST' ? {} : undefined })
      assert.equal(r.status, 401, p)
      assert.equal(r.json.error, 'this key was replaced by a newer one: use the latest key from the console, or rotate again')
    }
  }
  assert.equal((await call('GET', '/v1/alerts', { token: fresh })).status, 200)
  assert.equal((await call('GET', '/v1/alerts/telegram-chats', { token: fresh })).status, 200)
  assert.equal((await call('POST', '/v1/releases', { token: fresh, body: {} })).status, 503) // past the version check; this server has no wallet
  // An app with no rotation: a key without v still works.
  assert.equal((await call('GET', '/v1/alerts', { token: issueKey(SECRET, { address: me.address, app: 'mine2', iat: 1, exp: FAR }) })).status, 200)
  versions.delete('mine')
})

test('auth/key: a key issued after a rotation carries the current version', async () => {
  versions.set('mine', 4)
  const issuedAt = new Date().toISOString()
  const signature = await me.signMessage({ message: signInMessage(me.address, 'mine', issuedAt) })
  const r = await call('POST', '/v1/auth/key', { body: { address: me.address, app: 'mine', issuedAt, signature } })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(verifyKey(SECRET, r.json.apiKey)?.v, 4)
  versions.delete('mine')
  const out = await keyFromSignature(SECRET, { address: me.address, app: 'mine', issuedAt, signature }, Date.now(), async () => 0)
  assert.ok(out.ok && verifyKey(SECRET, out.value.apiKey)?.v === undefined)
})

test('auth/key: the publish sign-in also returns a console session for the same wallet, so one signature is enough', async () => {
  const issuedAt = new Date().toISOString()
  const signature = await me.signMessage({ message: signInMessage(me.address, 'mine', issuedAt) })
  const r = await call('POST', '/v1/auth/key', { body: { address: me.address, app: 'mine', issuedAt, signature } })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.match(r.json.session, /^hys_/)
  assert.ok(r.json.expires > Date.now())
  const apps = await call('GET', '/v1/console/apps', { token: r.json.session })
  assert.equal(apps.status, 200)
  assert.equal(apps.json.address.toLowerCase(), me.address.toLowerCase())
})

test('console channel routes: same behaviour through the session; 403 for an app it does not own', async () => {
  const { session } = (await login()).json
  const t = { token: session }
  assert.equal((await call('POST', '/v1/console/apps/theirs/alerts', { ...t, body: { kind: 'telegram', target: '-1000' } })).status, 403)
  assert.equal((await call('GET', '/v1/console/apps/theirs/telegram-chats', t)).status, 403)
  assert.equal((await call('DELETE', `/v1/console/apps/theirs/alerts/0x${'1'.repeat(64)}`, t)).status, 403)

  const bad = await call('POST', '/v1/console/apps/mine2/alerts', { ...t, body: { kind: 'slack', target: 'https://evil.example.com/x' } })
  assert.equal(bad.status, 400)
  const add = await call('POST', '/v1/console/apps/mine2/alerts', { ...t, body: { kind: 'telegram', target: '-1000' } })
  assert.equal(add.status, 201, JSON.stringify(add.json))
  const id = add.json.id
  assert.deepEqual((await call('POST', `/v1/console/apps/mine2/alerts/${id}/test`, t)).json, { sent: true })
  const chats = await call('GET', '/v1/console/apps/mine2/telegram-chats', t)
  assert.deepEqual(chats.json, { app: 'mine2', chats: [{ id: '-1000', title: 'chat' }] })
  assert.equal((await call('DELETE', `/v1/console/apps/mine/alerts/${id}`, t)).status, 404) // not that app's channel
  assert.deepEqual((await call('DELETE', `/v1/console/apps/mine2/alerts/${id}`, t)).json, { deleted: id })
  assert.equal((await call('PUT', '/v1/console/apps/mine/alerts', t)).status, 405)
})

test('ens link: 403 for an app the session does not own; a refused check is 409 with its reason; a good one is 201', async () => {
  const linked: string[] = []
  const s = build({
    console: {
      apps: async () => [],
      rotate: async () => ({ version: 1 }),
      linkEns: async (app: string, name: string, by: string) => {
        if (name === 'bad.eth') return { problem: 'bad.eth does not name mine' }
        linked.push(`${app}=${name} by ${by}`)
        return { name, resolver: '0xD0FcfcCcB378174ca736A4b4969B74Fb24850b58' }
      },
    },
  })
  const port = (s.address() as AddressInfo).port
  const at = (p: string, token: string, body: unknown) =>
    fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }))
  const now = Date.now()
  const token = issueSession(SECRET, { address: me.address, scope: 'console', iat: now, exp: now + 60_000 })
  assert.equal((await at('/v1/console/apps/theirs/ens', token, { name: 'theirs.eth' })).status, 403)
  const bad = await at('/v1/console/apps/mine/ens', token, { name: 'Not A Name' })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /ENS name/)
  const refused = await at('/v1/console/apps/mine/ens', token, { name: 'bad.eth' })
  assert.equal(refused.status, 409)
  assert.match(refused.json.error, /does not name mine/)
  const ok = await at('/v1/console/apps/mine/ens', token, { name: 'mine.eth' })
  assert.equal(ok.status, 201, JSON.stringify(ok.json))
  assert.equal(ok.json.name, 'mine.eth')
  assert.deepEqual(linked, [`mine=mine.eth by ${me.address}`])
  s.close()
})
