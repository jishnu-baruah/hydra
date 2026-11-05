import assert from 'node:assert/strict'
import { test } from 'node:test'
import { custom, toHex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import {
  GasBoundError,
  WriteNotVerifiedError,
  arkivClients,
  guardedCreate,
  guardedTransport,
  policyGas,
} from '../src/arkiv.ts'
import { LONG, ReleaseSchema, releaseValues } from '../src/records.ts'

const M = 1_000_000n

test('policyGas: small estimates get the 1,000,000 floor', () => {
  assert.equal(policyGas(200_000n, 30n * M), M)
})

test('policyGas: otherwise 2 x the estimate', () => {
  assert.equal(policyGas(M, 30n * M), 2n * M)
})

test('policyGas: the floor grows by 400,000 per extra operation', () => {
  assert.equal(policyGas(100_000n, 30n * M, 3), 1_800_000n)
})

test('policyGas: refuses gas over half the block limit', () => {
  assert.throws(() => policyGas(8n * M, 30n * M), GasBoundError)
})

// A fake Rabdi node. It answers the reads a create needs, rejects every raw transaction,
// and counts what was asked.
function fakeNode(o: { sendFails?: boolean } = {}) {
  const seen: string[] = []
  const transport = custom({
    async request({ method }: { method: string }) {
      seen.push(method)
      switch (method) {
        case 'eth_chainId':
          return toHex(7794095)
        case 'eth_blockNumber':
          return '0x1'
        case 'eth_getTransactionCount':
          return '0x0'
        case 'eth_gasPrice':
          return '0x1'
        case 'eth_estimateGas':
          return toHex(300_000n)
        case 'eth_getBlockByNumber':
          return { gasLimit: toHex(30n * M), number: '0x1', baseFeePerGas: null, timestamp: '0x0' }
        case 'eth_sendRawTransaction':
          throw new Error('HTTP request failed. URL: https://rpc.example/SECRETKEY connection reset')
        default:
          throw new Error(`fake node: unexpected ${method}`)
      }
    },
  })
  return { transport, seen }
}

const values = () =>
  releaseValues({ app: 'demo', version: '1', commit: 'c', swarmRef: 'r', fileCount: 1, publishedAt: 1793880000000, payload: {} })

test('guardedTransport hands the SDK 2 x the estimate (floored) and never retries', async () => {
  const { transport, seen } = fakeNode()
  const t = guardedTransport(transport)({ chain: undefined, retryCount: 3 } as never)
  const gas = await t.request({ method: 'eth_estimateGas', params: [{}] } as never)
  assert.equal(BigInt(gas as string), M) // 2 x 300,000 is under the 1,000,000 floor
  assert.deepEqual(seen, ['eth_estimateGas', 'eth_getBlockByNumber'])
})

test('guardedCreate sends at most 1 transaction, does not resend, and redacts the RPC URL', async () => {
  const { transport, seen } = fakeNode()
  const { walletClient, publicClient } = arkivClients({ privateKey: generatePrivateKey(), transport })
  await assert.rejects(
    guardedCreate({ walletClient: walletClient!, publicClient, schema: ReleaseSchema, values: values(), expiration: LONG() }),
    (err: Error) => {
      assert.ok(err instanceof WriteNotVerifiedError, err.message)
      assert.equal(err.phase, 'submission_unknown')
      assert.match(err.message, /Do not resend/)
      assert.doesNotMatch(err.message, /SECRETKEY|https?:\/\//)
      assert.equal(err.cause, undefined)
      return true
    },
  )
  assert.equal(seen.filter((m) => m === 'eth_sendRawTransaction').length, 1)
  // Explicit nonce at latest and explicit gasPrice were read before signing.
  assert.ok(seen.includes('eth_getTransactionCount'))
  assert.ok(seen.includes('eth_gasPrice'))
})

test('guardedCreate reports a bad value as preflight, with 0 transactions sent', async () => {
  const { transport, seen } = fakeNode()
  const { walletClient, publicClient } = arkivClients({ privateKey: generatePrivateKey(), transport })
  const bad = { ...values(), published_at: 1793880000000 } // bare number in a u64 column
  await assert.rejects(
    guardedCreate({ walletClient: walletClient!, publicClient, schema: ReleaseSchema, values: bad as never, expiration: LONG() }),
    (err: Error) => err instanceof WriteNotVerifiedError && err.phase === 'preflight',
  )
  assert.equal(seen.filter((m) => m === 'eth_sendRawTransaction').length, 0)
})
