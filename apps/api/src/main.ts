// Wires real dependencies from the environment and starts the API.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { arkivClients, guardedBatch, guardedCreate } from '@hydra/core'
import type { Hex } from 'viem'
import { runOnce } from '@hydra/indexer/run'
import { activity, claimOf, filesByHash, releasesFor } from './reads.ts'
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

const swarm =
  env.BEE_API_URL && env.SWARM_POSTAGE_BATCH_ID
    ? swarmUploader({ beeUrl: env.BEE_API_URL, batchId: env.SWARM_POSTAGE_BATCH_ID })
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
  activity: async () => (writer ? activity(publicClient, writer) : { head: null, events: [] }),
  health: { publisherWallet: walletClient?.account.address ?? null, accessKey: Boolean(env.ARKIV_ACCESS_KEY), indexer: Boolean(indexer) },
}

const port = Number(env.PORT ?? env.HYDRA_API_PORT ?? 8787)
createApi(deps).listen(port, () => console.log(`hydra api on :${port}`))
