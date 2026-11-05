import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readWithRetry, redact, rootCause } from '../src/arkiv.ts'

test('readWithRetry succeeds on the 3rd attempt after 2 transient failures', async () => {
  let calls = 0
  const out = await readWithRetry(
    async () => {
      calls++
      if (calls < 3) throw new Error('fetch failed')
      return 'ok'
    },
    { delayMs: 1 },
  )
  assert.equal(out, 'ok')
  assert.equal(calls, 3)
})

test('readWithRetry gives up after 3 attempts with the innermost cause and no cause object', async () => {
  let calls = 0
  await assert.rejects(
    readWithRetry(
      async () => {
        calls++
        throw new Error('outer', { cause: new Error('execution reverted: no funds') })
      },
      { delayMs: 1 },
    ),
    (err: Error) => {
      assert.match(err.message, /Arkiv read failed: execution reverted: no funds/)
      assert.equal(err.cause, undefined)
      return true
    },
  )
  assert.equal(calls, 3)
})

test('readWithRetry does not retry a permanent error', async () => {
  let calls = 0
  const bad = Object.assign(new Error('value does not fit the column'), {
    name: 'SchemaMismatchError',
  })
  await assert.rejects(
    readWithRetry(
      async () => {
        calls++
        throw bad
      },
      { delayMs: 1 },
    ),
  )
  assert.equal(calls, 1)
})

test('rootCause walks a nested cause chain', () => {
  const e = new Error('a', { cause: new Error('b', { cause: new Error('c') }) })
  assert.equal(rootCause(e), 'c')
})

test('redact removes keyed RPC URLs from error text', () => {
  const msg =
    'HTTP request failed. URL: https://rpc.rabdi.db-chain.testnet.arkiv.network/SECRETKEY123 ' +
    'Details: socket hang up (wss://rpc.rabdi.db-chain.testnet.arkiv.network/SECRETKEY123)'
  const out = redact(msg)
  assert.doesNotMatch(out, /SECRETKEY123/)
  assert.match(out, /URL: <rpc-url> Details/)
})
