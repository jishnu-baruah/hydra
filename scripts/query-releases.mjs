// The one query judges can run: the newest Hydra releases for an app, read straight from Arkiv
// (Rabdi testnet, public RPC, no key, no wallet), keeping only records our API wallet created.
//   node scripts/query-releases.mjs [app]        default app: demo-dapp
// Needs Node 24 (the Arkiv SDK 1.0.1 ESM build does not load on Node 22.17) and `pnpm install` once.
import { ReleaseSchema, arkivClients, desc, eq } from '../packages/core/src/index.ts'

const WRITER = '0xdD0d4167959291A2eb930Fe82Fed58070134348b' // the Hydra API wallet, see README
const app = process.argv[2] ?? 'demo-dapp'
const { publicClient } = arkivClients({})

const page = await publicClient
  .select({ $key: true, $expiresAt: true, version: true, commit: true, swarm_ref: true, file_count: true, published_at: true })
  .from(ReleaseSchema)
  .where(eq('app', app))
  .createdBy(WRITER)
  .orderBy(desc('published_at'))
  .limit(5)
  .fetch()

if (!page.entities.length) console.log(`no releases for app "${app}" created by ${WRITER}`)
for (const e of page.entities) {
  const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x)
  console.log(`${v(e.version)}  swarm_ref=${v(e.swarm_ref)}  files=${v(e.file_count)}  published=${new Date(Number(v(e.published_at))).toISOString()}`)
  console.log(`  entity ${e.$key}  https://rabdi.explorer.arkiv.network/entity/${e.$key}`)
}
