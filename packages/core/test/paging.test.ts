import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readAll } from '../src/arkiv.ts'

// A fake query over n rows, 100 per page, with `skip` rows per page that did not fit the schema.
const rows = (n: number, skip = 0) => {
  const offsets: number[] = []
  const page = async (offset: number) => {
    offsets.push(offset)
    const covered = Math.min(100, Math.max(0, n - offset))
    const s = Math.min(skip, covered)
    return { entities: Array.from({ length: covered - s }, (_, i) => offset + s + i), skipped: s }
  }
  return { page, offsets }
}

test('readAll reads every page until one covers fewer than 100', async () => {
  const q = rows(250)
  const out = await readAll(q.page)
  assert.equal(out.length, 250)
  assert.deepEqual(q.offsets, [0, 100, 200])
})

test('readAll counts skipped rows toward the offset', async () => {
  const q = rows(230, 5)
  const out = await readAll(q.page)
  assert.deepEqual(q.offsets, [0, 100, 200])
  assert.equal(out.length, 230 - 15)
})

test('readAll stops at maxRows', async () => {
  const q = rows(10_000)
  const out = await readAll(q.page, 300)
  assert.equal(out.length, 300)
  assert.deepEqual(q.offsets, [0, 100, 200])
})
