import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import {
  channelNotifier,
  checkTarget,
  deliver,
  discordBody,
  label,
  newSecret,
  open,
  openChannel,
  seal,
  signWebhook,
  slackBody,
  webhookRequest,
  type Verdict,
} from '../src/alerts.ts'

const KEY = 'ab'.repeat(32)

test('seal and open round trip; tampering or a wrong key fails', () => {
  const sealed = seal('{"target":"x"}', KEY)
  assert.equal(open(sealed, KEY), '{"target":"x"}')
  assert.notDeepEqual(seal('{"target":"x"}', KEY), sealed) // random IV
  const bad = Uint8Array.from(sealed)
  bad[bad.length - 1] ^= 1
  assert.throws(() => open(bad, KEY))
  const badTag = Uint8Array.from(sealed)
  badTag[13] ^= 1
  assert.throws(() => open(badTag, KEY))
  assert.throws(() => open(sealed, 'cd'.repeat(32)))
  assert.throws(() => open(sealed.slice(0, 20), KEY))
  assert.throws(() => seal('x', 'ab'), /64 hex/)
})

test('checkTarget accepts the four kinds and normalizes', () => {
  assert.deepEqual(checkTarget('webhook', ' https://Hooks.Example.com/in?x=1 '), { ok: true, value: { kind: 'webhook', target: 'https://hooks.example.com/in?x=1' } })
  assert.equal(checkTarget('slack', 'https://hooks.slack.com/services/T0/B0/XYZ').ok, true)
  assert.equal(checkTarget('discord', 'https://discord.com/api/webhooks/1/abc').ok, true)
  assert.equal(checkTarget('discord', 'https://discordapp.com/api/webhooks/1/abc').ok, true)
  assert.deepEqual(checkTarget('telegram', '-1001234567890'), { ok: true, value: { kind: 'telegram', target: '-1001234567890' } })
  assert.deepEqual(checkTarget('telegram', 42), { ok: true, value: { kind: 'telegram', target: '42' } })
})

test('checkTarget refuses bad kinds and targets with a reason', () => {
  const bad: [unknown, unknown, RegExp][] = [
    ['email', 'a@b.c', /"kind" must be one of/],
    ['webhook', 'http://hooks.example.com/', /public https URL/],
    ['webhook', 'https://127.0.0.1/', /public https URL/],
    ['webhook', 'https://localhost/x', /public https URL/],
    ['webhook', 'https://x.example.com:8443/', /public https URL/],
    ['webhook', 'https://u:p@x.example.com/', /public https URL/],
    ['webhook', `https://x.example.com/${'a'.repeat(500)}`, /500 characters/],
    ['webhook', 7, /public https URL/],
    ['slack', 'https://hooks.example.com/services/x', /hooks\.slack\.com\/services/],
    ['slack', 'https://hooks.slack.com/other', /hooks\.slack\.com\/services/],
    ['discord', 'https://evil.com/api/webhooks/1/a', /discord\.com\/api\/webhooks/],
    ['telegram', '12a', /chat id/],
    ['telegram', '1'.repeat(21), /chat id/],
    ['telegram', '', /chat id/],
  ]
  for (const [k, t, re] of bad) {
    const r = checkTarget(k, t)
    assert.equal(r.ok, false, `${k} ${t}`)
    assert.match((r as { error: string }).error, re, `${k} ${t}`)
  }
})

test('label never shows the full target', () => {
  assert.equal(label('webhook', 'https://hooks.example.com/secret/path?token=1'), 'Webhook to hooks.example.com')
  assert.equal(label('slack', 'https://hooks.slack.com/services/T0/B0/XYZ'), 'Slack incoming webhook')
  assert.equal(label('discord', 'https://discord.com/api/webhooks/1/abc'), 'Discord webhook')
  assert.equal(label('telegram', '-1001234567890'), 'Telegram chat ...7890')
})

// The example from the Standard Webhooks spec.
test('signWebhook matches the Standard Webhooks example', () => {
  const sig = signWebhook('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}')
  assert.equal(sig, 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=')
})

test('newSecret is whsec_ plus 24 random bytes in base64', () => {
  const s = newSecret()
  assert.match(s, /^whsec_[A-Za-z0-9+/]{32}$/)
  assert.equal(Buffer.from(s.slice(6), 'base64').length, 24)
  assert.notEqual(s, newSecret())
})

const V: Verdict = {
  app: 'demo',
  domain: 'app.demo.xyz',
  from: 'match',
  to: 'mismatch',
  problems: ['EXTRA https://evil.example/x.js', 'DOMAIN_PROOF_LOST gone'],
  text: 'Hydra alert: app.demo.xyz (app demo) is now MISMATCH (was match).\n- EXTRA https://evil.example/x.js',
  observedAt: 1793880000000,
}

test('webhookRequest: the verdict JSON, signed over id.timestamp.body', () => {
  const secret = newSecret()
  const r = webhookRequest(V, secret, { id: 'msg_1', now: 1793880001234 })
  assert.deepEqual(JSON.parse(r.body), {
    type: 'hydra.verdict', app: 'demo', domain: 'app.demo.xyz', from: 'match', to: 'mismatch',
    problems: V.problems, observed_at: V.observedAt, explorer: 'https://hydra-registry.vercel.app/app/?name=demo',
  })
  assert.equal(r.headers['webhook-id'], 'msg_1')
  assert.equal(r.headers['webhook-timestamp'], '1793880001')
  assert.equal(r.headers['webhook-signature'], signWebhook(secret, 'msg_1', 1793880001, r.body))
  assert.equal(r.headers['Content-Type'], 'application/json')
  assert.equal(JSON.parse(webhookRequest({ ...V, test: true }, secret).body).type, 'hydra.test')
  const many = JSON.parse(webhookRequest({ ...V, problems: Array(50).fill('x'.repeat(900)) }, secret).body)
  assert.equal(many.problems.length, 20)
  assert.equal(many.problems[0].length, 500)
})

test('slackBody escapes markup from site data; discordBody pings nobody and fits 2000 chars', () => {
  const s = slackBody({ ...V, text: '<!channel> & <https://evil|click>' })
  assert.ok(s.text.includes('&lt;!channel&gt; &amp; &lt;https://evil|click&gt;'))
  assert.ok(!s.text.includes('<!channel>'))
  assert.ok(s.text.includes('https://hydra-registry.vercel.app/app/?name=demo'))
  const d = discordBody({ ...V, text: '@everyone ' + 'x'.repeat(5000) })
  assert.deepEqual(d.allowed_mentions, { parse: [] })
  assert.ok(d.content.length <= 2000)
  assert.ok(slackBody({ ...V, text: 'y'.repeat(9000) }).text.length <= 3000)
})

const WEBHOOK = 'https://hooks.example.com/SECRETPATH'

test('deliver posts once on 2xx, retries 5xx and network errors, stops on 4xx, and never leaks the URL', async () => {
  const run = async (answers: (number | Error)[], ch = { kind: 'webhook' as const, target: WEBHOOK, secret: newSecret() }) => {
    const posts: { url: string; headers: Record<string, string> }[] = []
    const post = async (url: string, _b: string, headers: Record<string, string>) => {
      posts.push({ url, headers })
      const a = answers[posts.length - 1]
      if (a instanceof Error) throw a
      return { status: a }
    }
    return { r: await deliver(ch, V, { post, delayMs: 0 }), posts }
  }
  const ok = await run([204])
  assert.deepEqual(ok.r, { ok: true })
  assert.equal(ok.posts.length, 1)
  assert.equal(ok.posts[0].url, WEBHOOK)
  assert.match(ok.posts[0].headers['webhook-signature'], /^v1,/)

  const flaky = await run([503, new Error('the request failed (ECONNRESET)'), 200])
  assert.deepEqual(flaky.r, { ok: true })
  assert.equal(flaky.posts.length, 3)

  const gone = await run([404, 200])
  assert.equal(gone.posts.length, 1)
  assert.equal(gone.r.ok, false)
  assert.match((gone.r as { error: string }).error, /HTTP 404/)

  const down = await run([500, 502, 503])
  assert.equal(down.posts.length, 3)
  const redirect = await run([302])
  assert.match((redirect.r as { error: string }).error, /redirect/)
  for (const r of [gone.r, down.r, redirect.r]) assert.doesNotMatch((r as { error: string }).error, /SECRETPATH|hooks\.example|whsec_/)
})

test('deliver sends Slack and Discord bodies without signature headers, and Telegram to the chat id', async () => {
  const bodies: [string, Record<string, string>][] = []
  const post = async (_u: string, b: string, h: Record<string, string>) => (bodies.push([b, h]), { status: 200 })
  await deliver({ kind: 'slack', target: 'https://hooks.slack.com/services/T/B/X' }, V, { post })
  await deliver({ kind: 'discord', target: 'https://discord.com/api/webhooks/1/a' }, V, { post })
  assert.ok('text' in JSON.parse(bodies[0][0]))
  assert.ok('content' in JSON.parse(bodies[1][0]))
  assert.equal(bodies[0][1]['webhook-signature'], undefined)
  const chats: string[] = []
  const r = await deliver({ kind: 'telegram', target: '-100123' }, V, { telegram: async (chat, text) => (chats.push(chat, text), { ok: true }) })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(chats, ['-100123', `${V.text}\nhttps://hydra-registry.vercel.app/app/?name=demo`])
  const off = await deliver({ kind: 'telegram', target: '-100123' }, V, {})
  assert.match((off as { error: string }).error, /Telegram is not configured/)
})

test('openChannel refuses a sealed channel of another app or a broken one', () => {
  const sub = (app: string, kind = 'webhook') => ({ id: '0x1', kind, created_at: 1, sealed: seal(JSON.stringify({ app, target: WEBHOOK, secret: 'whsec_x' }), KEY) })
  assert.deepEqual(openChannel(sub('demo'), 'demo', KEY), { kind: 'webhook', target: WEBHOOK, secret: 'whsec_x' })
  assert.equal(openChannel(sub('other'), 'demo', KEY), null)
  assert.equal(openChannel(sub('demo', 'email'), 'demo', KEY), null)
  assert.equal(openChannel({ ...sub('demo'), sealed: randomBytes(40) }, 'demo', KEY), null)
})

test('channelNotifier delivers to each channel of the app and logs failures without targets', async () => {
  const subs = [
    { id: '0xa', kind: 'webhook', created_at: 1, sealed: seal(JSON.stringify({ app: 'demo', target: WEBHOOK, secret: newSecret() }), KEY) },
    { id: '0xb', kind: 'telegram', created_at: 2, sealed: seal(JSON.stringify({ app: 'demo', target: '-100123' }), KEY) },
  ]
  const logs: string[] = []
  const got: string[] = []
  const notify = channelNotifier({
    key: KEY,
    list: async (app) => (app === 'demo' ? subs : []),
    deliver: async (ch) => (got.push(ch.kind), ch.kind === 'telegram' ? { ok: false, error: 'Telegram HTTP 400: chat not found' } : { ok: true }),
    log: (l) => logs.push(l),
  })
  await notify({ ...V })
  await notify({ ...V, app: undefined }) // unbound site: no channels
  assert.deepEqual(got, ['webhook', 'telegram'])
  assert.equal(logs.length, 1)
  assert.match(logs[0], /channel 0xb of demo failed: .*chat not found/)
  assert.doesNotMatch(logs.join(), /SECRETPATH|-100123/)
})
