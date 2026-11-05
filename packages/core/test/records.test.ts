import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generatePrivateKey } from 'viem/accounts'
import { arkivClients } from '../src/arkiv.ts'
import {
  AppSchema,
  FileSchema,
  LONG,
  ObservationSchema,
  ReleaseSchema,
  SCHEMAS,
  appValues,
  fileValues,
  observationValues,
  releaseValues,
} from '../src/records.ts'

// Offline. The SDK validates values against the schema before it sends anything, so a create
// pointed at a closed port fails on the network if and only if the values are valid.
const { walletClient } = arkivClients({
  accessKey: 'offline-test',
  privateKey: generatePrivateKey(),
  rpcUrl: 'http://127.0.0.1:65530',
})
const VALIDATION = /SchemaMismatch|InvalidValue|MissingValue|InvalidAttributeName|TooLarge/

// 'network' only for an HTTP failure, so an unrelated error can never pass as "valid".
async function create(schema: Parameters<NonNullable<typeof walletClient>['createEntity']>[0], values: object) {
  try {
    await walletClient!.createEntity(schema, values as never, { expiration: LONG() })
    return 'sent'
  } catch (err) {
    const e = err as Error
    if (VALIDATION.test(e.name)) return `invalid: ${e.name}`
    return e.name === 'HttpRequestError' ? 'network' : `other: ${e.name}`
  }
}

const NOW = 1793880000000
const KEY = `0x${'ab'.repeat(32)}` as const

test('every column name is lowercase snake_case', () => {
  for (const s of SCHEMAS) {
    for (const name of Object.keys(s.columns)) assert.match(name, /^[a-z][a-z0-9_]*$/, `${s.name}.${name}`)
  }
})

test('app record values pass the SDK schema check', async () => {
  const v = appValues({ app: 'demo', domain: 'demo.example', publisher: 'team-a', createdAt: NOW, payload: { name: 'Demo', domains: ['demo.example'] } })
  assert.equal(await create(AppSchema, v), 'network')
})

test('release record values pass the SDK schema check', async () => {
  const v = releaseValues({ app: 'demo', version: '2026-11-06.1', commit: 'abc123', swarmRef: 'f'.repeat(64), fileCount: 3, publishedAt: NOW, payload: { ci_run_url: 'https://github.com/x/y/actions/runs/1' } })
  assert.equal(await create(ReleaseSchema, v), 'network')
})

test('file record values pass the SDK schema check', async () => {
  const v = fileValues({ app: 'demo', sha256: `sha256-${'0'.repeat(64)}`, path: '/assets/app.js', release: KEY })
  assert.equal(await create(FileSchema, v), 'network')
})

test('observation record values pass the SDK schema check', async () => {
  const v = observationValues({ domain: 'demo.example', status: 'mismatch', observedAt: NOW, scriptsHash: 'f'.repeat(64), payload: { scripts: [{ url: 'https://demo.example/app.js', sha256: 'f'.repeat(64) }] } })
  assert.equal(await create(ObservationSchema, v), 'network')
})

test('control: a bare number in a u64 time column is rejected before sending', async () => {
  const v = { ...releaseValues({ app: 'demo', version: '1', commit: 'c', swarmRef: 'r', fileCount: 1, publishedAt: NOW, payload: {} }), published_at: NOW }
  assert.match(await create(ReleaseSchema, v), /^invalid:/)
})
