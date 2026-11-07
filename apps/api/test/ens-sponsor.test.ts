import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSponsor, STEP_LABELS, sponsorLabelProblem, type SponsorActions } from '../src/ens-sponsor.ts'
import { issueSession } from '../src/console.ts'
import { createApi } from '../src/server.ts'

const TEAM = '0x00000000000000000000000000000000000000aa'
const RES = '0x00000000000000000000000000000000000000bb'
const calls: string[] = []
const fakes = (over: Partial<SponsorActions> = {}): SponsorActions => ({
  isAvailable: async (l) => (calls.push(`available ${l}`), l !== 'taken'),
  deployResolver: async () => (calls.push('deploy'), { tx: '0x1', resolver: RES }),
  configureResolver: async (o) => (calls.push(`configure ${o.label} ${o.app} ${o.team}`), '0x2'),
  prepareFee: async () => (calls.push('fee'), ['0x3', '0x4']),
  commit: async () => (calls.push('commit'), '0x5'),
  waitCommitment: async () => void calls.push('wait'),
  register: async () => (calls.push('register'), '0x6'),
  verifyAndLink: async (o) => (calls.push(`link ${o.name}`), { name: o.name, resolver: RES }),
  ...over,
})
const done = async (s: ReturnType<typeof createSponsor>, app: string) => {
  for (let i = 0; i < 200 && s.status(app).state === 'running'; i++) await new Promise((r) => setTimeout(r, 5))
  return s.status(app)
}

test('label rules', () => {
  assert.equal(sponsorLabelProblem('my-app'), null)
  assert.match(sponsorLabelProblem('ab')!, /register a different name yourself/)
  assert.match(sponsorLabelProblem('My_App')!, /register a different name yourself/)
  for (const bad of ['-foo', 'foo-', 'ab--cd', 'xn--abc']) assert.match(sponsorLabelProblem(bad)!, /register a different name yourself/, bad)
  assert.equal(sponsorLabelProblem('a-b-c'), null)
})

test('steps run in order, one at a time, and the job ends done with every tx', async () => {
  calls.length = 0
  const s = createSponsor({ actions: fakes() })
  const r = s.start('myapp', TEAM)
  assert.deepEqual(r, { ok: true, step: STEP_LABELS[0] })
  assert.match(STEP_LABELS[0], /^1 of 6 /)
  const j = await done(s, 'myapp')
  assert.equal(j.state, 'done')
  assert.equal(j.name, 'myapp.eth')
  assert.deepEqual(j.txs, ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6'])
  assert.deepEqual(calls, ['available myapp', 'deploy', `configure myapp myapp ${TEAM}`, 'fee', 'commit', 'wait', 'register', 'link myapp.eth'])
})

test('a taken name fails the job before any transaction', async () => {
  calls.length = 0
  const s = createSponsor({ actions: fakes() })
  s.start('taken', TEAM)
  const j = await done(s, 'taken')
  assert.equal(j.state, 'failed')
  assert.match(j.error!, /taken\.eth is taken or too short: register a different name yourself in the console/)
  assert.deepEqual(calls, ['available taken'])
})

test('a failed step stops the job, names the step and cause, redacts URLs, never retries', async () => {
  calls.length = 0
  const s = createSponsor({
    actions: fakes({
      commit: async () => {
        calls.push('commit')
        throw new Error('rpc https://secret.example/key123 timed out')
      },
    }),
  })
  s.start('myapp', TEAM)
  const j = await done(s, 'myapp')
  assert.equal(j.state, 'failed')
  assert.match(j.error!, /4 of 6/)
  assert.doesNotMatch(j.error!, /secret\.example|key123/)
  assert.match(j.error!, /not retried/i)
  assert.equal(calls.filter((c) => c === 'commit').length, 1)
  assert.ok(!calls.includes('register'))
  assert.deepEqual(j.txs, ['0x1', '0x2', '0x3', '0x4'])
})

test('limits: one running or done job per app, 3 per wallet per day, a global cap per day', async () => {
  let t = 1_000_000
  const s = createSponsor({ actions: fakes(), now: () => t, perWallet: 3, perDay: 5 })
  assert.equal(s.start('app-one', TEAM).ok, true)
  const again = s.start('app-one', TEAM)
  assert.equal(again.ok, false)
  assert.match((again as { problem: string }).problem, /already/)
  await done(s, 'app-one')
  assert.equal(s.start('app-one', TEAM).ok, false) // done: still one per app
  assert.equal(s.start('app-two', TEAM).ok, true)
  assert.equal(s.start('app-three', TEAM).ok, true)
  const w = s.start('app-four', TEAM)
  assert.match((w as { problem: string }).problem, /3 sponsored setups per wallet/)
  const other = '0x00000000000000000000000000000000000000cc'
  assert.equal(s.start('app-five', other).ok, true)
  assert.equal(s.start('app-six', other).ok, true)
  const g = s.start('app-seven', other)
  assert.match((g as { problem: string }).problem, /5 sponsored setups per day/)
  t += 25 * 3_600_000
  assert.equal(s.start('app-seven', other).ok, true) // a day later
})

test('a failed job may be started again', async () => {
  let n = 0
  const s = createSponsor({
    actions: fakes({
      deployResolver: async () => {
        if (n++ === 0) throw new Error('boom')
        return { tx: '0x1', resolver: RES }
      },
    }),
  })
  s.start('myapp', TEAM)
  assert.equal((await done(s, 'myapp')).state, 'failed')
  assert.equal(s.start('myapp', TEAM).ok, true)
  assert.equal((await done(s, 'myapp')).state, 'done')
})

test('status of an unknown app is none', () => {
  assert.deepEqual(createSponsor({ actions: fakes() }).status('x-app'), { state: 'none', step: null, name: null, error: null, txs: [] })
})

test('routes: auth, 403 for a non-owner, 202 start, 409 on a second, GET status, 503 when unconfigured', async () => {
  const SECRET = 'x'.repeat(40)
  const me = privateKeyToAccount(generatePrivateKey())
  const owners = new Map([['mine', me.address.toLowerCase()], ['theirs', '0x' + 'dd'.repeat(20)]])
  const sponsor = createSponsor({ actions: fakes() })
  const build = (on: boolean) =>
    createApi({
      secret: SECRET,
      claimOf: async (app: string) => (owners.has(app) ? { owner: owners.get(app)!, key: `0x${'aa'.repeat(32)}` as const } : null),
      console: { apps: async () => [], rotate: async () => ({ version: 1 }), sponsorEns: on ? { start: sponsor.start, status: sponsor.status } : undefined },
    } as never).listen(0)
  const s = build(true)
  const off = build(false)
  after(() => s.close())
  const call = (srv: typeof s, method: string, p: string, token?: string) =>
    fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${p}`, { method, headers: { connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) } }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, any> }))
  const now = Date.now()
  const token = issueSession(SECRET, { address: me.address, scope: 'console', iat: now, exp: now + 60_000 })
  assert.equal((await call(s, 'POST', '/v1/console/apps/mine/ens/setup')).status, 401)
  assert.equal((await call(s, 'POST', '/v1/console/apps/theirs/ens/setup', token)).status, 403)
  assert.equal((await call(s, 'GET', '/v1/console/apps/theirs/ens/setup', token)).status, 403)
  assert.equal((await call(s, 'PUT', '/v1/console/apps/mine/ens/setup', token)).status, 405)
  assert.equal((await call(off, 'POST', '/v1/console/apps/mine/ens/setup', token)).status, 503)
  const started = await call(s, 'POST', '/v1/console/apps/mine/ens/setup', token)
  assert.equal(started.status, 202, JSON.stringify(started.json))
  assert.equal(started.json.state, 'running')
  assert.match(started.json.step, /^1 of 6/)
  assert.equal((await call(s, 'POST', '/v1/console/apps/mine/ens/setup', token)).status, 409)
  await done(sponsor, 'mine')
  const st = await call(s, 'GET', '/v1/console/apps/mine/ens/setup', token)
  assert.equal(st.status, 200)
  assert.equal(st.json.state, 'done')
  assert.equal(st.json.name, 'mine.eth')
  await new Promise((r) => setTimeout(r, 100))
})
