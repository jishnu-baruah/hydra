import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatIdReplies } from '../src/alerts.ts'

const NOW = 1_800_000_000_000
const msg = (update_id: number, text: string, secsAgo = 5, chat = { id: -1001234, title: 'Team' }) =>
  ({ update_id, message: { chat, text, date: Math.floor(NOW / 1000) - secsAgo } })

test('"/hydra <app>" gets the chat id, the app and the next step', () => {
  const r = chatIdReplies([msg(1, '/hydra demo-dapp')], new Set(), NOW - 60_000)
  assert.equal(r.length, 1)
  assert.equal(r[0].chatId, '-1001234')
  assert.match(r[0].text, /-1001234/)
  assert.match(r[0].text, /demo-dapp/)
  assert.match(r[0].text, /15 minutes/)
})

test('"/chatid" and "/hydra@Bot" also get the id; other text gets nothing', () => {
  const r = chatIdReplies([msg(1, '/chatid'), msg(2, '/hydra@hydraAlert1Bot demo-dapp'), msg(3, 'hello'), msg(4, '/hydra')], new Set(), NOW - 60_000)
  assert.deepEqual(r.map((x) => x.updateId), [1, 2, 4])
  assert.doesNotMatch(r[2].text, /undefined/)
})

test('each message is answered once', () => {
  const seen = new Set<number>()
  assert.equal(chatIdReplies([msg(1, '/chatid')], seen, NOW - 60_000).length, 1)
  assert.equal(chatIdReplies([msg(1, '/chatid')], seen, NOW - 60_000).length, 0)
})

test('messages from before the server started are not answered (no replies flood after a restart)', () => {
  assert.equal(chatIdReplies([msg(1, '/chatid', 600)], new Set(), NOW - 60_000).length, 0)
})

test('junk updates are skipped', () => {
  assert.deepEqual(chatIdReplies([null, {}, { update_id: 9 }, { update_id: 'x', message: { text: '/chatid' } }], new Set(), 0), [])
  assert.deepEqual(chatIdReplies('nope', new Set(), 0), [])
})
