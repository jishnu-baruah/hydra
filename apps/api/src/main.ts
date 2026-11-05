// Wires real dependencies from the environment and starts the API.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { arkivClients, guardedBatch, guardedCreate } from '@hydra/core'
import type { Hex } from 'viem'
import { filesByHash, releasesFor } from './reads.ts'
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

const deps: ApiDeps = {
  secret,
  corsOrigin: env.HYDRA_CORS_ORIGIN,
  publishScript: () => readFile(script, 'utf8'),
  publish: walletClient
    ? {
        createOne: (spec) => guardedCreate({ walletClient, publicClient, ...spec }),
        createMany: (specs) => guardedBatch({ walletClient, publicClient, creates: specs }),
        swarm,
      }
    : undefined,
  releasesFor: (app) => releasesFor(publicClient, app),
  filesByHash: (sha) => filesByHash(publicClient, sha),
  health: { publisherWallet: walletClient?.account.address ?? null, accessKey: Boolean(env.ARKIV_ACCESS_KEY) },
}

const port = Number(env.PORT ?? env.HYDRA_API_PORT ?? 8787)
createApi(deps).listen(port, () => console.log(`hydra api on :${port}`))
