import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rootCause, withRetry } from '../src/arkiv.ts'

test('withRetry succeeds on the 3rd attempt after 2 transient failures', async () => {
  let calls = 0
  const out = await withRetry(
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

test('withRetry gives up after 3 attempts and reports the innermost cause', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      async () => {
        calls++
        throw new Error('outer', { cause: new Error('execution reverted: no funds') })
      },
      { delayMs: 1 },
    ),
    /Arkiv call failed: execution reverted: no funds/,
  )
  assert.equal(calls, 3)
})

test('withRetry does not retry a permanent error', async () => {
  let calls = 0
  const bad = Object.assign(new Error('value does not fit the column'), {
    name: 'SchemaMismatchError',
  })
  await assert.rejects(
    withRetry(
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
