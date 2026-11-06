import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sendAlerts, type AlertEvent } from '../src/run.ts'

const AT = 1793880000000
const prev = { status: 'match', problems: [] as string[] }
const sites = [
  { domain: 'a.example.com', app: 'demo', status: 'mismatch', problems: ['EXTRA https://evil.example/x.js'], prev },
  { domain: 'b.example.com', app: 'other', status: 'match', problems: [], prev }, // no news
  { domain: 'c.example.com', status: 'mismatch', problems: ['CHANGED app.js'], prev },
]

test('sendAlerts calls notify once per alert with the verdict fields, and the team chat too', async () => {
  const seen: AlertEvent[] = []
  const team: string[] = []
  const out = await sendAlerts(sites, AT, {
    live: true,
    token: 't',
    chatId: '1',
    notify: async (e) => void seen.push(e),
    send: async (o) => (team.push(o.chatId), { ok: true }),
  })
  assert.equal(out.alerts, 2)
  assert.deepEqual(out.errors, [])
  assert.equal(team.length, 2)
  assert.equal(seen.length, 2)
  assert.deepEqual({ ...seen[0], text: undefined }, {
    app: 'demo', domain: 'a.example.com', from: 'match', to: 'mismatch', problems: ['EXTRA https://evil.example/x.js'], observedAt: AT, text: undefined,
  })
  assert.match(seen[0].text, /a\.example\.com \(app demo\) is now MISMATCH/)
  assert.equal(seen[1].app, undefined)
})

test('sendAlerts on a dry run notifies nobody; a failing notifier is reported, not thrown', async () => {
  let calls = 0
  const dry = await sendAlerts(sites, AT, { live: false, notify: async () => void calls++ })
  assert.equal(dry.alerts, 2)
  assert.equal(calls, 0)
  const bad = await sendAlerts(sites.slice(0, 1), AT, { live: true, notify: async () => { throw new Error('boom') } })
  assert.match(bad.errors[0], /alert channels for a\.example\.com failed: boom/)
})
