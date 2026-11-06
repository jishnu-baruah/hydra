import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROOF_PATH, checkProof, isPrivateAddress, normalizeDomain, proofNames } from '../src/domain.ts'

test('normalizeDomain lowercases and drops a trailing dot', () => {
  assert.equal(normalizeDomain(' App.Example.com. '), 'app.example.com')
})

test('normalizeDomain refuses anything that is not a public hostname', () => {
  for (const bad of ['localhost', 'example', '127.0.0.1', '10.0.0.1', '[::1]', 'x.local', 'x.internal', 'x.localhost',
    'https://x.com', 'x.com:8080', 'x.com/path', 'a..b.com', '-a.com', 'a-.com', 'a_b.com', '', 'a'.repeat(64) + '.com', 7, null])
    assert.equal(normalizeDomain(bad), null, String(bad))
})

test('isPrivateAddress flags loopback, private, link-local and mapped addresses', () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    '0:0:0:0:0:0:0:1', '::127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:a00:1::1', '2001:db8::1', 'not-an-ip'])
    assert.equal(isPrivateAddress(ip), true, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
    assert.equal(isPrivateAddress(ip), false, ip)
})

test('proofNames needs an exact hydra-app=<app> line', () => {
  assert.equal(proofNames('hydra-app=demo\n', 'demo'), true)
  assert.equal(proofNames('# Hydra\r\n  hydra-app=demo  \r\nother=1', 'demo'), true)
  assert.equal(proofNames('hydra-app=demo2', 'demo'), false)
  assert.equal(proofNames('x hydra-app=demo', 'demo'), false)
  assert.equal(proofNames('hydra-app=Demo', 'demo'), false)
  assert.equal(proofNames('', 'demo'), false)
})

const pub = async () => [{ address: '93.184.216.34', family: 4 }]
const text = (body: string, status = 200) => async () => ({ status, body })

test('checkProof passes when the file names the app', async () => {
  let asked: unknown[] = []
  const r = await checkProof('app.example.com', 'demo', {
    lookup: pub,
    get: async (...a) => ((asked = a), { status: 200, body: 'hydra-app=demo\n' }),
  })
  assert.deepEqual(r, { ok: true })
  // Connects to the address that was checked, so a second DNS answer cannot redirect it.
  assert.deepEqual(asked, ['app.example.com', { address: '93.184.216.34', family: 4 }, PROOF_PATH])
})

test('checkProof refuses a domain that resolves to a private address, without fetching', async () => {
  let fetched = false
  const r = await checkProof('evil.example.com', 'demo', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
    get: async () => ((fetched = true), { status: 200, body: 'hydra-app=demo' }),
  })
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /private address/)
  assert.equal(fetched, false)
})

test('checkProof reports a missing file, a wrong app and a bad domain with the fix', async () => {
  const missing = await checkProof('app.example.com', 'demo', { lookup: pub, get: text('nope', 404) })
  assert.match((missing as { reason: string }).reason, /HTTP 404.*hydra-app=demo/)
  assert.equal((missing as { transient?: boolean }).transient, undefined)
  const wrong = await checkProof('app.example.com', 'demo', { lookup: pub, get: text('hydra-app=other') })
  assert.match((wrong as { reason: string }).reason, /does not contain the line hydra-app=demo/)
  const bad = await checkProof('localhost', 'demo', { lookup: pub, get: text('hydra-app=demo') })
  assert.match((bad as { reason: string }).reason, /not a public hostname/)
})

test('checkProof marks server errors and network failures as transient, not lost', async () => {
  const down = await checkProof('app.example.com', 'demo', { lookup: pub, get: text('oops', 503) })
  assert.equal((down as { transient?: boolean }).transient, true)
  const reset = await checkProof('app.example.com', 'demo', { lookup: pub, get: async () => { throw new Error('ECONNRESET') } })
  assert.equal((reset as { transient?: boolean }).transient, true)
  assert.match((reset as { reason: string }).reason, /ECONNRESET/)
})

test('checkProof ignores a file over 4 KiB', async () => {
  const r = await checkProof('app.example.com', 'demo', { lookup: pub, get: async () => ({ status: 200, body: null }) })
  assert.match((r as { reason: string }).reason, /over 4096 bytes/)
})
