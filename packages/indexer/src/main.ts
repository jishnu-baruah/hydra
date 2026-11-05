// Indexer CLI. Production runs inside the API (POST /v1/indexer/run, called by GitHub Actions);
// this is for local runs.
//   node src/main.ts            run forever, every INDEXER_INTERVAL_MIN (15) minutes
//   node src/main.ts --once     one run
//   node src/main.ts --dry      one run, print only, no writes
// Env: ARKIV_INDEXER_PRIVATE_KEY, ARKIV_ACCESS_KEY (optional), HYDRA_API_URL.

import { arkivClients, rootCause } from '@hydra/core'
import type { Hex } from 'viem'
import { runOnce } from './run.ts'

const env = process.env
const DRY = process.argv.includes('--dry')
const ONCE = DRY || process.argv.includes('--once')
const api = (env.HYDRA_API_URL ?? 'https://hydra-api-5xmn.onrender.com').replace(/\/+$/, '')
const INTERVAL_MS = Number(env.INDEXER_INTERVAL_MIN ?? 15) * 60_000

const key = env.ARKIV_INDEXER_PRIVATE_KEY as Hex | undefined
if (!DRY && !key) {
  console.error('ARKIV_INDEXER_PRIVATE_KEY is not set; use --dry to scan without writing.')
  process.exit(1)
}
const clients = DRY ? null : arkivClients({ accessKey: env.ARKIV_ACCESS_KEY, privateKey: key })
if (clients) console.log(`indexer wallet ${clients.walletClient!.account.address}, every ${INTERVAL_MS / 60_000} min`)

do {
  const t0 = Date.now()
  try {
    const s = await runOnce({ api, clients })
    for (const line of s.lines) console.log(line)
    for (const tx of s.txs) console.log(`wrote observations: tx ${tx}`)
    for (const e of s.errors) console.error(e)
    console.log(`${s.sites} sites, ${s.written} observations written, ${s.ms} ms`)
  } catch (err) {
    console.error(`run failed: ${rootCause(err)}`)
  }
  if (ONCE) break
  await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - t0))))
} while (true)
