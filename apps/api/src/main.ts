// Wires real dependencies from the environment and starts the API.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { arkivClients, guardedBatch, guardedCreate } from '@hydra/core'
import type { Hex } from 'viem'
import { runOnce } from '@hydra/indexer/run'
import { privateKeyToAccount } from 'viem/accounts'
import { sitesView, type TargetInfo } from './observations.ts'
import { activity, claimOf, filesByHash, observations, releasesFor } from './reads.ts'
import { createApi, type ApiDeps } from './server.ts'
import { swarmUploader } from './swarm.ts'

const env = process.env
const secret = env.HYDRA_KEY_SECRET ?? ''
if (secret.length < 32) {
  console.error('HYDRA_KEY_SECRET must be at least 32 characters (it signs every API key).')
  process.exit(1)
}

const { publicClient, walletClient } = arkivClients({
  accessKey: env.ARKIV_ACCESS_KEY,
  privateKey: env.ARKIV_PRIVATE_KEY ? (env.ARKIV_PRIVATE_KEY as Hex) : undefined,
})

const swarm = env.BEE_API_URL
  ? swarmUploader({ beeUrl: env.BEE_API_URL, batchId: env.SWARM_POSTAGE_BATCH_ID?.trim() || undefined })
  : undefined

const script = fileURLToPath(new URL('../../../packages/action/publish.mjs', import.meta.url))

// Reads trust only records our own wallet created; set HYDRA_PUBLISHER_ADDRESS for a read-only API.
const writer = (walletClient?.account.address ?? env.HYDRA_PUBLISHER_ADDRESS) as Hex | undefined
const allow = (env.HYDRA_ALLOWED_ADDRESSES ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean)

// The indexer runs inside the API with its own wallet, triggered by a scheduled GitHub Actions job.
const indexerKey = env.ARKIV_INDEXER_PRIVATE_KEY as Hex | undefined
const indexer =
  indexerKey && (env.INDEXER_TRIGGER_SECRET ?? '').length >= 32
    ? (() => {
        const clients = arkivClients({ accessKey: env.ARKIV_ACCESS_KEY, privateKey: indexerKey })
        const port = Number(env.PORT ?? env.HYDRA_API_PORT ?? 8787)
        return { secret: env.INDEXER_TRIGGER_SECRET!, run: () => runOnce({ api: `http://127.0.0.1:${port}`, clients }) }
      })()
    : undefined

// The indexed-sites page: the indexer wallet's newest observations joined with the target list.
const indexerAddress = (indexerKey ? privateKeyToAccount(indexerKey).address : env.HYDRA_INDEXER_ADDRESS) as Hex | undefined
const targetsFile = fileURLToPath(new URL('../../../packages/indexer/targets.json', import.meta.url))
let sitesCache: { at: number; body: unknown } | undefined
const sites = async () => {
  if (!indexerAddress) return { summary: null, sites: [] }
  // Cached 30 s: the page polls, and Arkiv reads are the slow part.
  if (sitesCache && Date.now() - sitesCache.at < 30_000) return sitesCache.body
  const { targets } = JSON.parse(await readFile(targetsFile, 'utf8')) as { targets: TargetInfo[] }
  const body = sitesView(targets, (await observations(publicClient, indexerAddress)) as never)
  sitesCache = { at: Date.now(), body }
  return body
}

const deps: ApiDeps = {
  secret,
  corsOrigin: env.HYDRA_CORS_ORIGIN,
  publishScript: () => readFile(script, 'utf8'),
  publish: walletClient
    ? {
        createOne: (spec) => guardedCreate({ walletClient, publicClient, ...spec }),
        createMany: (specs, extensions) => guardedBatch({ walletClient, publicClient, creates: specs, extensions }),
        swarm,
      }
    : undefined,
  claimOf: writer ? (app) => claimOf(publicClient, writer, app) : undefined,
  allowedAddresses: allow.length ? new Set(allow) : undefined,
  publishesPerHour: env.HYDRA_PUBLISHES_PER_HOUR ? Number(env.HYDRA_PUBLISHES_PER_HOUR) : undefined,
  releasesFor: async (app) => (writer ? releasesFor(publicClient, writer, app) : []),
  filesByHash: async (sha) => (writer ? filesByHash(publicClient, writer, sha) : []),
  indexer,
  observations: sites,
  activity: async () => (writer ? activity(publicClient, writer) : { head: null, events: [] }),
  health: { publisherWallet: walletClient?.account.address ?? null, accessKey: Boolean(env.ARKIV_ACCESS_KEY), indexer: Boolean(indexer) },
}

const port = Number(env.PORT ?? env.HYDRA_API_PORT ?? 8787)
createApi(deps).listen(port, () => console.log(`hydra api on :${port}`))
