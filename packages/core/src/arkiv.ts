// Arkiv clients for the Rabdi testnet, following Arkiv's guides/known-issues and guides/quickstart
// for SDK 1.0.1:
//   - Reads may retry. Writes never resend automatically: one guarded path, one transaction.
//   - Writes use an explicit nonce and gasPrice read at `latest`, and gas of at least
//     max(1,000,000, 2 x estimate) that stays under half the block gas limit.
//   - The keyed RPC URL is a secret, so every error we raise is redacted and carries no `cause`.

import { createPublicClient, createWalletClient } from '@arkiv-network/sdk'
import { rabdi } from '@arkiv-network/sdk/chains'
import { http, toHex, type Hex, type Transport } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const RABDI_CHAIN_ID = 7794095
export const GAS_FLOOR = 1_000_000n
const GAS_PER_EXTRA_OP = 400_000n
// When gas is omitted, SDK 1.0.1 sends min(estimate x 125 / 100, 2^24) of whatever the
// transport's eth_estimateGas returned.
const SDK_GAS_CAP = 2n ** 24n

const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>)\]]+/gi
export const redact = (text: string): string => text.replace(URL_PATTERN, '<rpc-url>')

// viem wraps a revert about six errors deep; the useful line is the innermost cause.
export function rootCause(err: unknown): string {
  let e: unknown = err
  while (e instanceof Error && e.cause instanceof Error) e = e.cause
  return redact(e instanceof Error ? e.message : String(e))
}

export class GasBoundError extends Error {
  override name = 'GasBoundError'
}

// The gas we hand the SDK as its "estimate", so the gas it finally sends meets the rule.
export function policyGas(estimate: bigint, blockGasLimit: bigint, ops = 1): bigint {
  const floor = GAS_FLOOR + GAS_PER_EXTRA_OP * BigInt(ops - 1)
  const wanted = estimate * 2n > floor ? estimate * 2n : floor
  const scaled = (wanted * 125n) / 100n
  const sent = scaled < SDK_GAS_CAP ? scaled : SDK_GAS_CAP
  if (sent < wanted || sent * 2n > blockGasLimit) {
    throw new GasBoundError(
      `gas ${sent} for an estimate of ${estimate} breaks the bound (at least ${wanted}, at most ` +
        `half the block limit ${blockGasLimit}); split the write`,
    )
  }
  return wanted
}

// Wraps the write transport: no transport-level retries, and gas estimates go through policyGas.
export function guardedTransport(base: Transport): Transport {
  return (args) => {
    const t = base({ ...args, retryCount: 0 })
    const request = (async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_estimateGas') {
        const estimate = BigInt((await t.request({ method, params } as never)) as string)
        const head = (await t.request({
          method: 'eth_getBlockByNumber',
          params: ['latest', false],
        } as never)) as { gasLimit: string }
        return toHex(policyGas(estimate, BigInt(head.gasLimit)))
      }
      return t.request({ method, params } as never)
    }) as typeof t.request
    return { ...t, request }
  }
}

// `transport` is for tests; production passes the access key and uses Rabdi's keyed RPC.
export function arkivClients(o: {
  accessKey?: string
  privateKey?: Hex
  rpcUrl?: string
  transport?: Transport
}) {
  const chain = rabdi({ accessKey: o.accessKey ?? '' })
  const read = o.transport ?? http(o.rpcUrl, { timeout: 10_000 })
  const write = guardedTransport(o.transport ?? http(o.rpcUrl, { timeout: 30_000, retryCount: 0 }))
  const publicClient = createPublicClient({ chain, transport: read })
  const walletClient = o.privateKey
    ? createWalletClient({ chain, transport: write, account: privateKeyToAccount(o.privateKey) })
    : undefined
  return { publicClient, walletClient }
}

// Errors that will fail the same way every time: bad values, bad expiry, too large.
const PERMANENT = new Set([
  'SchemaMismatchError',
  'InvalidValueError',
  'InvalidExpiryError',
  'EntityTooLargeError',
  'MissingValueError',
  'InvalidAttributeNameError',
  'MissingAccessKeyError',
  'GasBoundError',
])

export const isPermanent = (err: unknown): boolean =>
  err instanceof Error && PERMANENT.has(err.name)

// READS ONLY. Retries transient failures (network, rate limits) up to `tries` times with backoff.
// Never wrap a write in this: use guardedCreate.
export async function readWithRetry<T>(
  fn: () => Promise<T>,
  o: { tries?: number; delayMs?: number } = {},
): Promise<T> {
  const tries = o.tries ?? 3
  const delayMs = o.delayMs ?? 500
  let last: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (isPermanent(err) || attempt === tries) break
      await new Promise((r) => setTimeout(r, delayMs * 2 ** (attempt - 1)))
    }
  }
  throw new Error(`Arkiv read failed: ${rootCause(last)}`)
}

// `phase` says what the caller may do next. `preflight`: nothing was sent, safe to try again
// later. `submission_unknown` or `submitted`: a transaction may exist, so do NOT resend; look up
// `txHash` (if any) and reconcile with a query first.
export class WriteNotVerifiedError extends Error {
  override name = 'WriteNotVerifiedError'
  readonly phase: 'preflight' | 'submission_unknown' | 'submitted'
  readonly txHash: Hex | undefined
  // Plain fields, not constructor parameter properties: Node's type stripping rejects those.
  constructor(phase: WriteNotVerifiedError['phase'], txHash: Hex | undefined, detail: string) {
    super(
      `Arkiv write not verified (${phase}${txHash ? `, tx ${txHash}` : ''}): ${detail}` +
        (phase === 'preflight' ? '' : '. Do not resend; reconcile this transaction first.'),
    )
    this.phase = phase
    this.txHash = txHash
  }
}

type Wallet = NonNullable<ReturnType<typeof arkivClients>['walletClient']>
type Reader = ReturnType<typeof arkivClients>['publicClient']
type CreateArgs = Parameters<Wallet['createEntity']>

// One signer, one queue: writes from the same wallet run strictly one after another.
const queues = new WeakMap<object, Promise<unknown>>()

export function guardedCreate(c: {
  walletClient: Wallet
  publicClient: Reader
  schema: CreateArgs[0]
  values: CreateArgs[1]
  expiration: CreateArgs[2]['expiration']
}) {
  const before = queues.get(c.walletClient) ?? Promise.resolve()
  const run = before.catch(() => undefined).then(() => createOnce(c))
  queues.set(c.walletClient, run)
  return run
}

async function createOnce(c: Parameters<typeof guardedCreate>[0]) {
  let phase: WriteNotVerifiedError['phase'] = 'preflight'
  let txHash: Hex | undefined
  try {
    const address = c.walletClient.account.address
    if ((await c.publicClient.getChainId()) !== RABDI_CHAIN_ID) throw new Error('RPC is not Rabdi')
    const nonce = await c.publicClient.getTransactionCount({ address, blockTag: 'latest' })
    const gasPrice = await c.publicClient.getGasPrice()
    phase = 'submission_unknown'
    const result = await c.walletClient.createEntity(
      c.schema,
      c.values,
      { expiration: c.expiration },
      { nonce, gasPrice },
    )
    txHash = result.txHash
    phase = 'submitted'
    const receipt = await c.publicClient.getTransactionReceipt({ hash: result.txHash })
    if (receipt.status !== 'success') throw new Error(`receipt status is ${receipt.status}`)
    return result
  } catch (err) {
    // A failure before anything was signed is still preflight.
    if (isPermanent(err)) phase = phase === 'submission_unknown' ? 'preflight' : phase
    throw new WriteNotVerifiedError(phase, txHash, rootCause(err))
  }
}
