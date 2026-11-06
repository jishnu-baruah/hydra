import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from '../src/jina.ts'

const PAGE = 'https://app.example.com/'
const HTML = '<html><script src="/a.js"></script></html>'
const reply = (status: number, body = '') => async () => new Response(body, { status })

test('no key: no calls, state off', async () => {
  let calls = 0
  const r = createRenderer({ key: undefined, fetch: async () => (calls++, new Response(HTML)) })
  assert.equal(await r.render(PAGE), null)
  assert.equal(calls, 0)
  assert.deepEqual(r.report(), { state: 'off', calls: 0, failed: 0, reason: 'JINA_KEY is not set', skipped: 0 })
})

test('a rendered page with scripts is returned and counted ok', async () => {
  const r = createRenderer({ key: 'k', fetch: reply(200, HTML) })
  assert.equal(await r.render(PAGE), HTML)
  assert.deepEqual(r.report(), { state: 'ok', calls: 1, failed: 0, reason: '', skipped: 0 })
})

test('a page with no scripts (a bot check) is null but not a failure', async () => {
  const r = createRenderer({ key: 'k', fetch: reply(200, '<html>Just a moment</html>') })
  assert.equal(await r.render(PAGE), null)
  assert.equal(r.report().failed, 0)
  assert.equal(r.report().state, 'ok')
})

test('credit out (402) names the cause and stops calling after 3 failures in a row', async () => {
  let calls = 0
  const r = createRenderer({ key: 'k', fetch: async () => (calls++, new Response('{"name":"InsufficientBalanceError"}', { status: 402 })) })
  for (let i = 0; i < 6; i++) assert.equal(await r.render(PAGE), null)
  assert.equal(calls, 3) // the breaker opened after 3, the other 3 never left the machine
  const rep = r.report()
  assert.equal(rep.state, 'failed')
  assert.equal(rep.failed, 3)
  assert.equal(rep.skipped, 3)
  assert.match(rep.reason, /HTTP 402.*credit/i)
})

test('a success resets the failure streak, so scattered failures do not open the breaker', async () => {
  const seq = [500, 200, 500, 200, 500, 200]
  let i = 0
  const r = createRenderer({ key: 'k', fetch: async () => { const s = seq[i++]; return new Response(s === 200 ? HTML : 'x', { status: s }) } })
  for (let n = 0; n < 6; n++) await r.render(PAGE)
  assert.equal(i, 6)
  assert.equal(r.report().state, 'ok')
  assert.equal(r.report().failed, 3)
})

test('a network error or timeout is a failure with its cause', async () => {
  const r = createRenderer({ key: 'k', fetch: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) } })
  assert.equal(await r.render(PAGE), null)
  assert.match(r.report().reason, /timed out/i)
  const net = createRenderer({ key: 'k', fetch: async () => { throw new Error('fetch failed') } })
  await net.render(PAGE)
  assert.match(net.report().reason, /network/i)
})

test('401 reads as a bad key', async () => {
  const r = createRenderer({ key: 'k', fetch: reply(401) })
  await r.render(PAGE)
  assert.match(r.report().reason, /HTTP 401.*key/i)
})
