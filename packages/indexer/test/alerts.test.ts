import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alertText, sendTelegram } from '../src/alerts.ts'

const at = Date.UTC(2026, 10, 6, 5, 0)
const site = (status: string, problems: string[] = []) => ({ domain: 'app.example.com', app: 'demo', status, problems })

test('alertText: a site turning mismatch alerts with its new problems', () => {
  const t = alertText(site('mismatch', ['EXTRA https://evil.example/x.js', 'TRUNCATED 90 scripts']), { status: 'match', problems: [] }, at)
  assert.ok(t)
  assert.match(t!, /app\.example\.com \(app demo\) is now MISMATCH/)
  assert.match(t!, /EXTRA https:\/\/evil\.example\/x\.js/)
  assert.doesNotMatch(t!, /TRUNCATED/) // noise codes are left out
})

test('alertText: an unchanged mismatch does not alert again', () => {
  const p = ['EXTRA https://evil.example/x.js']
  assert.equal(alertText(site('mismatch', p), { status: 'mismatch', problems: p }, at), null)
})

test('alertText: a new loud code on an unbound site alerts, noise codes never do', () => {
  assert.match(String(alertText(site('unknown', ['NEW_RUNTIME_ORIGIN https://cdn.new.example']), { status: 'unknown', problems: [] }, at)), /NEW_RUNTIME_ORIGIN/)
  assert.equal(alertText(site('unknown', ['UNREACHABLE HTTP 403', 'TRUNCATED 9']), { status: 'unknown', problems: [] }, at), null)
  assert.equal(alertText(site('unknown', ['CHANGED /a.js']), null, at), null) // first sight is not news
})

test('alertText: mismatch back to match is a recovery', () => {
  assert.match(String(alertText(site('match'), { status: 'mismatch', problems: ['EXTRA x'] }, at)), /recovered: MATCH/)
})

test('alertText: caps problems and length', () => {
  const many = Array.from({ length: 20 }, (_, i) => `EXTRA https://x.example/${'a'.repeat(400)}${i}`)
  const t = String(alertText(site('mismatch', many), { status: 'match', problems: [] }, at))
  assert.ok(t.length < 2000)
  assert.match(t, /and 15 more/)
})

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

test('sendTelegram posts plain text to the chat and reports ok', async () => {
  let url = ''
  let sent: Record<string, unknown> = {}
  const r = await sendTelegram({ token: 'T0KEN', chatId: '-100', text: 'hi' }, async (u, i) => ((url = String(u)), (sent = JSON.parse(String(i?.body))), reply(200, { ok: true })))
  assert.deepEqual(r, { ok: true })
  assert.equal(url, 'https://api.telegram.org/botT0KEN/sendMessage')
  assert.equal(sent.chat_id, '-100')
  assert.equal(sent.parse_mode, undefined) // plain text: site data cannot inject markup
})

test('sendTelegram retries 429 and 5xx up to 3 attempts, never leaks the token', async () => {
  let n = 0
  const r = await sendTelegram({ token: 'T0KEN', chatId: '1', text: 'x', delayMs: 1 }, async () => (n++, n < 3 ? reply(429, { ok: false, parameters: { retry_after: 0 } }) : reply(200, { ok: true })))
  assert.deepEqual(r, { ok: true })
  assert.equal(n, 3)
  let m = 0
  const bad = await sendTelegram({ token: 'T0KEN', chatId: '1', text: 'x', delayMs: 1 }, async () => (m++, reply(502, { ok: false, description: 'Bad Gateway' })))
  assert.equal(m, 3)
  assert.equal(bad.ok, false)
  assert.doesNotMatch((bad as { error: string }).error, /T0KEN/)
})

test('sendTelegram does not retry a 400 and names the cause', async () => {
  let n = 0
  const r = await sendTelegram({ token: 'T0KEN', chatId: '1', text: 'x', delayMs: 1 }, async () => (n++, reply(400, { ok: false, description: 'Bad Request: chat not found' })))
  assert.equal(n, 1)
  assert.match((r as { error: string }).error, /chat not found.*TELEGRAM_CHAT_ID/)
})
