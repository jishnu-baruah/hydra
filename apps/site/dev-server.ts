// Local demo of the whole onboarding flow with no keys, funds or Bee node:
//   node apps/site/dev-server.ts     site on :5174, API on :8788 (in-memory Arkiv and Swarm)
// Open http://localhost:5174/?api=http://localhost:8788. Nothing here touches a chain.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppSchema, ReleaseSchema, sha256Tag } from '@hydra/core'
import { createApi } from '../api/src/server.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const flat = (v: unknown) => {
  const x = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v
  return typeof x === 'bigint' ? x.toString() : x
}
const owners = new Map<string, string>()
const releases: Record<string, unknown>[] = []
let n = 0
const fakeHash = () => `0x${(++n).toString(16).padStart(64, '0')}` as const

createApi({
  secret: 'dev-only-secret-'.repeat(3),
  corsOrigin: '*',
  publishScript: () => readFile(join(here, '../../packages/action/publish.mjs'), 'utf8'),
  ownerOf: async (app) => owners.get(app) ?? null,
  releasesFor: async (app) => releases.filter((r) => r.app === app).toReversed(),
  publish: {
    createOne: async (spec) => {
      const v = Object.fromEntries(Object.entries(spec.values).map(([k, x]) => [k, flat(x)]))
      if (spec.schema === AppSchema) owners.set(String(v.app), String(v.publisher))
      const key = fakeHash()
      if (spec.schema === ReleaseSchema) releases.push({ $key: key, ...v, body: undefined })
      return { entityKey: key, txHash: fakeHash() }
    },
    createMany: async (specs) => ({ createdEntities: specs.map(fakeHash), txHash: fakeHash() }),
    swarm: async (files) => sha256Tag(Buffer.concat(files.map((f) => f.data))).slice(7),
  },
  health: { mode: 'dev, in-memory' },
}).listen(8788, () => console.log('dev api on :8788'))

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
createServer(async (req, res) => {
  const path = normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^[/\\]+/, '') || 'index.html'
  try {
    const body = await readFile(join(here, path))
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(5174, () => console.log('site on http://localhost:5174/?api=http://localhost:8788'))
