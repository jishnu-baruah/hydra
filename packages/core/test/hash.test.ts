import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { sha256File, sha256Tag } from '../src/hash.ts'
import { fitStr } from '../src/attr.ts'

// Expected values come from `sha256sum test/fixtures/*`.
const SHA256SUM = {
  'app.js': '5c89360c3698ae159f876aea6c0038146668345494ce068b4a2d0f843a29ec39',
  'blob.bin': '785b0751fc2c53dc14a4ce3d800e69ef9ce1009eb327ccf458afe09c242c26c9',
  'index.html': 'bb9714f9a08b459bb6faa29c3248cfd33dfea8cafd7a676654315f7a11c64c53',
}

for (const [name, want] of Object.entries(SHA256SUM)) {
  test(`sha256File matches sha256sum for ${name}`, async () => {
    const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
    assert.equal(await sha256File(path), want)
  })
}

test('sha256Tag prefixes the hex digest', () => {
  assert.equal(
    sha256Tag(''),
    'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})

test('fitStr keeps a value of up to 128 bytes and hashes a longer one to 71 bytes', () => {
  assert.equal(fitStr('/assets/app.js'), '/assets/app.js')
  const long = `https://cdn.vendor.example/${'x'.repeat(200)}.js`
  const fitted = fitStr(long)
  assert.match(fitted, /^sha256-[0-9a-f]{64}$/)
  assert.equal(Buffer.byteLength(fitted), 71)
})
