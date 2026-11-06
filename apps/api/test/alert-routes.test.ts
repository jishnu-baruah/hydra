import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { open, type Channel, type StoredSub } from '../src/alerts.ts'
import { issueKey } from '../src/keys.ts'
import { createApi, type AlertRoutes } from '../src/server.ts'

const SECRET = 'x'.repeat(40)
const ALERT_KEY = 'ab'.repeat(32)
const FAR = Date.parse('2100-01-01T00:00:00Z')
const ADDR = '0x00000000000000000000000000000000000000aa'
const keyFor = (app = 'demo', address = ADDR) => issueKey(SECRET, { address, app, iat: 1, exp: FAR })

// A fake Arkiv store and a fake delivery; nothing leaves the process.
const rows: (StoredSub & { app: string })[] = []
const sent: { ch: Channel; test?: boolean }[] = []
let failNext = ''
let n = 0
const alerts: AlertRoutes = {
  key: ALERT_KEY,
  store: {
    list: async (app) => rows.filter((r) => r.app === app),
    create: async (app, kind, sealed, createdAt) => {
      const id = `0x${(++n).toString(16).padStart(64, '0')}`
      rows.push({ id, app, kind, created_at: createdAt, sealed })
      return { id }
    },
    remove: async (id) => void rows.splice(rows.findIndex((r) => r.id === id), 1),
  },
  deliver: async (ch, v) => {
    sent.push({ ch, test: v.test })
    if (failNext) {
      const error = failNext
      failNext = ''
      return { ok: false, error }
    }
    return { ok: true }
  },
  bot: () => 'hydra_alerts_bot',
  writesPerHour: 13,
}
const server = createApi({ secret: SECRET, alerts }).listen(0)
const bare = createApi({ secret: SECRET }).listen(0)
const nokey = createApi({ secret: SECRET, alerts: { ...alerts, key: undefined } }).listen(0)
const nostore = createApi({ secret: SECRET, alerts: { ...alerts, store: undefined } }).listen(0)
after(() => [server, bare, nokey, nostore].forEach((s) => s.close()))

const url = (s: typeof server, path: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${path}`
async function call(method: string, path: string, o: { key?: string; body?: unknown; srv?: typeof server } = {}) {
  const res = await fetch(url(o.srv ?? server, path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

const SLACK = 'https://hooks.slack.com/services/T0/B0/SECRETSLACK'
const HOOK = 'https://hooks.example.com/SECRETPATH'

test('alert routes: 401 without a valid key; 503 naming the missing piece', async () => {
  assert.equal((await call('GET', '/v1/alerts')).status, 401)
  assert.equal((await call('GET', '/v1/alerts', { key: 'hyd_bad.key' })).status, 401)
  const off = await call('GET', '/v1/alerts', { key: keyFor(), srv: bare })
  assert.equal(off.status, 503)
  assert.match(String(off.json.error), /ALERT_KEY/)
  assert.match(String((await call('POST', '/v1/alerts', { key: keyFor(), srv: nokey, body: {} })).json.error), /ALERT_KEY/)
  assert.match(String((await call('GET', '/v1/alerts', { key: keyFor(), srv: nostore })).json.error), /Arkiv/)
})

test('alert routes: telegram-bot is public', async () => {
  assert.deepEqual((await call('GET', '/v1/alerts/telegram-bot')).json, { username: 'hydra_alerts_bot' })
  assert.deepEqual((await call('GET', '/v1/alerts/telegram-bot', { srv: bare })).json, { username: null })
})

test('alert routes: add validates, tests first, stores sealed, and lists labels only', async () => {
  const bad = await call('POST', '/v1/alerts', { key: keyFor(), body: { kind: 'slack', target: 'https://evil.example.com/x' } })
  assert.equal(bad.status, 400)
  assert.match(String(bad.json.error), /hooks\.slack\.com/)

  failNext = 'Slack answered HTTP 404; check the URL'
  const failed = await call('POST', '/v1/alerts', { key: keyFor(), body: { kind: 'slack', target: SLACK } })
  assert.equal(failed.status, 502)
  assert.match(String(failed.json.error), /HTTP 404.*Nothing was saved/)
  assert.equal(rows.length, 0)

  const slack = await call('POST', '/v1/alerts', { key: keyFor(), body: { kind: 'slack', target: SLACK } })
  assert.equal(slack.status, 201, JSON.stringify(slack.json))
  assert.deepEqual(Object.keys(slack.json).sort(), ['id', 'kind', 'label'])
  assert.equal(sent.at(-1)?.test, true)

  const hook = await call('POST', '/v1/alerts', { key: keyFor(), body: { kind: 'webhook', target: HOOK } })
  assert.equal(hook.status, 201)
  assert.match(String(hook.json.secret), /^whsec_/)
  assert.equal(sent.at(-1)?.ch.secret, hook.json.secret) // the test message was signed with it

  // Sealed: the stored bytes hold no target in the clear, and open to the app, target and secret.
  const raw = Buffer.from(rows[1].sealed).toString('latin1')
  assert.ok(!raw.includes('SECRETPATH'))
  assert.deepEqual(JSON.parse(open(rows[1].sealed, ALERT_KEY)), { app: 'demo', target: HOOK, secret: hook.json.secret })

  const list = await call('GET', '/v1/alerts', { key: keyFor() })
  assert.equal(list.status, 200)
  assert.equal(list.json.app, 'demo')
  const text = JSON.stringify(list.json)
  assert.ok(!/SECRET|whsec_/.test(text), text)
  assert.deepEqual((list.json.channels as { label: string }[]).map((c) => c.label), ['Slack incoming webhook', 'Webhook to hooks.example.com'])

  // Another app's key sees none of them.
  assert.deepEqual((await call('GET', '/v1/alerts', { key: keyFor('other') })).json.channels, [])
})

test('alert routes: test, delete and ownership', async () => {
  const id = rows[0].id
  assert.deepEqual((await call('POST', `/v1/alerts/${id}/test`, { key: keyFor() })).json, { sent: true })
  failNext = 'Slack answered HTTP 410'
  const down = await call('POST', `/v1/alerts/${id}/test`, { key: keyFor() })
  assert.equal(down.status, 502)
  assert.match(String(down.json.error), /410/)

  assert.equal((await call('DELETE', `/v1/alerts/${id}`, { key: keyFor('other') })).status, 404)
  assert.equal((await call('POST', `/v1/alerts/${id}/test`, { key: keyFor('other') })).status, 404)
  assert.equal(rows.length, 2)
  assert.deepEqual((await call('DELETE', `/v1/alerts/${id}`, { key: keyFor() })).json, { deleted: id })
  assert.equal(rows.length, 1)
  assert.equal((await call('DELETE', `/v1/alerts/${id}`, { key: keyFor() })).status, 404)
})

test('alert routes: a 6th channel is refused with 409, and writes are rate limited per app', async () => {
  for (let i = rows.length; i < 5; i++) {
    assert.equal((await call('POST', '/v1/alerts', { key: keyFor(), body: { kind: 'telegram', target: `-100${i}` } })).status, 201)
  }
  const sixth = await call('POST', '/v1/alerts', { key: keyFor(), body: { kind: 'telegram', target: '-1009' } })
  assert.equal(sixth.status, 409)
  assert.match(String(sixth.json.error), /5 alert channels/)
  // writesPerHour is 13 here; every write attempt after auth counts: 4 adds, 2 tests, 2 deletes, 4 adds, the refused 6th = 13
  let limited = false
  for (let i = 0; i < 3 && !limited; i++) limited = (await call('POST', `/v1/alerts/${rows[0].id}/test`, { key: keyFor() })).status === 429
  assert.ok(limited)
  // Reads are not limited, and other apps are not affected.
  assert.equal((await call('GET', '/v1/alerts', { key: keyFor() })).status, 200)
  assert.equal((await call('POST', '/v1/alerts', { key: keyFor('other'), body: { kind: 'telegram', target: '-1' } })).status, 201)
})
