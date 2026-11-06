import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROOF_PATH, checkProof, isPrivateAddress, normalizeDomain, proofNames, safeGet, safePost } from '../src/domain.ts'

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

// safeGet: the fetch the indexer uses for pages and scripts on domains a publisher chose.
const site = (pages: Record<string, { status: number; location?: string; body?: string }>) => {
  const asked: string[] = []
  const get = async (host: string, addr: { address: string }, path: string) => {
    asked.push(`${host}${path}@${addr.address}`)
    const p = pages[`${host}${path}`] ?? { status: 404 }
    return { status: p.status, location: p.location, body: p.body === undefined ? Buffer.from('') : Buffer.from(p.body) }
  }
  return { get, asked }
}

test('safeGet returns the body from the checked address', async () => {
  const s = site({ 'app.example.com/a.js?v=1': { status: 200, body: 'x' } })
  const body = await safeGet('https://app.example.com/a.js?v=1', { maxBytes: 100 }, { lookup: pub, get: s.get })
  assert.equal(Buffer.from(body).toString(), 'x')
  assert.deepEqual(s.asked, ['app.example.com/a.js?v=1@93.184.216.34'])
})

test('safeGet refuses http, other ports, credentials and IP literals before any lookup', async () => {
  let looked = 0
  const lookup = async () => (looked++, [{ address: '93.184.216.34', family: 4 }])
  for (const url of ['http://app.example.com/', 'https://app.example.com:8443/', 'https://u:p@app.example.com/',
    'https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/latest', 'https://localhost/', 'ftp://app.example.com/'])
    await assert.rejects(safeGet(url, { maxBytes: 100 }, { lookup, get: site({}).get }), /public https URL/, url)
  assert.equal(looked, 0)
})

test('safeGet refuses a host that resolves to a private address', async () => {
  const s = site({ 'evil.example.com/': { status: 200, body: 'x' } })
  await assert.rejects(
    safeGet('https://evil.example.com/', { maxBytes: 100 }, { lookup: async () => [{ address: '10.0.0.5', family: 4 }], get: s.get }),
    /private address/,
  )
  assert.equal(s.asked.length, 0)
})

test('safeGet rechecks every redirect hop and stops after 3', async () => {
  const toPrivate = site({ 'app.example.com/': { status: 302, location: 'http://127.0.0.1:8080/admin' } })
  await assert.rejects(safeGet('https://app.example.com/', { maxBytes: 100 }, { lookup: pub, get: toPrivate.get }), /public https URL/)
  assert.equal(toPrivate.asked.length, 1)
  const ok = site({ 'app.example.com/': { status: 301, location: '/next' }, 'app.example.com/next': { status: 200, body: 'y' } })
  assert.equal(Buffer.from(await safeGet('https://app.example.com/', { maxBytes: 100 }, { lookup: pub, get: ok.get })).toString(), 'y')
  const loop = site({ 'app.example.com/': { status: 302, location: '/' } })
  await assert.rejects(safeGet('https://app.example.com/', { maxBytes: 100 }, { lookup: pub, get: loop.get }), /redirects/)
  assert.equal(loop.asked.length, 4)
})

test('safeGet reports HTTP errors and oversize bodies', async () => {
  await assert.rejects(safeGet('https://app.example.com/x', { maxBytes: 100 }, { lookup: pub, get: site({}).get }), /HTTP 404/)
  const big = async () => ({ status: 200, body: null })
  await assert.rejects(safeGet('https://app.example.com/', { maxBytes: 100 }, { lookup: pub, get: big }), /over 100 bytes/)
})

// safePost: the POST alert channels use for URLs a team chose. Same address rules as safeGet, but
// no redirects, and errors never carry the URL (a Slack or Discord URL is a secret).
const SECRET_URL = 'https://hooks.example.com/services/T000/SECRETPATH?token=abc'
const poster = (status = 200, fail?: Error) => {
  const asked: { host: string; address: string; method: string; path: string; headers: Record<string, string>; body?: string; maxBytes: number; timeoutMs: number }[] = []
  const request = async (host: string, addr: { address: string }, r: { method: string; path: string; headers: Record<string, string>; body?: string; maxBytes: number; timeoutMs: number }) => {
    asked.push({ host, address: addr.address, ...r })
    if (fail) throw fail
    return { status, location: status >= 300 && status < 400 ? 'https://elsewhere.example.com/' : undefined, body: Buffer.from('ok') }
  }
  return { request, asked }
}

test('safePost sends the body and headers to the checked address and returns the status', async () => {
  const p = poster(204)
  const r = await safePost(SECRET_URL, '{"a":1}', { 'Content-Type': 'application/json' }, { lookup: pub, request: p.request })
  assert.deepEqual(r, { status: 204 })
  assert.equal(p.asked.length, 1)
  const a = p.asked[0]
  assert.equal(a.host, 'hooks.example.com')
  assert.equal(a.address, '93.184.216.34')
  assert.equal(a.method, 'POST')
  assert.equal(a.path, '/services/T000/SECRETPATH?token=abc')
  assert.equal(a.body, '{"a":1}')
  assert.equal(a.headers['Content-Type'], 'application/json')
  assert.equal(a.timeoutMs, 10_000)
  assert.equal(a.maxBytes, 64 * 1024)
})

test('safePost never follows a redirect: it returns the 3xx status after one request', async () => {
  const p = poster(302)
  assert.deepEqual(await safePost(SECRET_URL, '{}', {}, { lookup: pub, request: p.request }), { status: 302 })
  assert.equal(p.asked.length, 1)
})

test('safePost refuses non-public URLs before any lookup, without echoing the URL', async () => {
  let looked = 0
  const lookup = async () => (looked++, [{ address: '93.184.216.34', family: 4 }])
  for (const url of ['http://hooks.example.com/SECRETPATH', 'https://hooks.example.com:8443/SECRETPATH', 'https://u:SECRETPATH@hooks.example.com/',
    'https://127.0.0.1/SECRETPATH', 'https://[::1]/SECRETPATH', 'https://localhost/SECRETPATH', 'not a url SECRETPATH']) {
    await assert.rejects(safePost(url, '{}', {}, { lookup, request: poster().request }), (e: Error) => /not a public https URL/.test(e.message) && !e.message.includes('SECRETPATH'), url)
  }
  assert.equal(looked, 0)
})

test('safePost refuses a host with any private address, without sending', async () => {
  const p = poster()
  await assert.rejects(
    safePost(SECRET_URL, '{}', {}, { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }], request: p.request }),
    (e: Error) => /private address/.test(e.message) && !e.message.includes('hooks.example.com'),
  )
  assert.equal(p.asked.length, 0)
})

test('safePost names a timeout or network failure without the URL or the address', async () => {
  const t = poster(200, new Error('timed out after 10 s'))
  await assert.rejects(safePost(SECRET_URL, '{}', {}, { lookup: pub, request: t.request }), /timed out/)
  const refused = Object.assign(new Error('connect ECONNREFUSED 93.184.216.34:443 hooks.example.com SECRETPATH'), { code: 'ECONNREFUSED' })
  await assert.rejects(
    safePost(SECRET_URL, '{}', {}, { lookup: pub, request: poster(200, refused).request }),
    (e: Error) => /ECONNREFUSED/.test(e.message) && !/SECRETPATH|93\.184|hooks\.example/.test(e.message),
  )
})
