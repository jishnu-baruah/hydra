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
// `ops` reports how many operations the write in flight carries, for the per-operation floor.
export function guardedTransport(base: Transport, ops: () => number = () => 1): Transport {
  return (args) => {
    const t = base({ ...args, retryCount: 0 })
    const request = (async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_estimateGas') {
        const estimate = BigInt((await t.request({ method, params } as never)) as string)
        const head = (await t.request({
          method: 'eth_getBlockByNumber',
          params: ['latest', false],
        } as never)) as { gasLimit: string }
        return toHex(policyGas(estimate, BigInt(head.gasLimit), ops()))
      }
      return t.request({ method, params } as never)
    }) as typeof t.request
    return { ...t, request }
  }
}

// Operation count of the write in flight, per wallet. Safe because each wallet's writes are queued.
const inFlightOps = new WeakMap<object, { n: number }>()

// `transport` is for tests; production passes the access key and uses Rabdi's keyed RPC.
export function arkivClients(o: {
  accessKey?: string
  privateKey?: Hex
  rpcUrl?: string
  transport?: Transport
}) {
  const chain = rabdi({ accessKey: o.accessKey ?? '' })
  const ops = { n: 1 }
  const read = o.transport ?? http(o.rpcUrl, { timeout: 10_000 })
  const write = guardedTransport(
    o.transport ?? http(o.rpcUrl, { timeout: 30_000, retryCount: 0 }),
    () => ops.n,
  )
  const publicClient = createPublicClient({ chain, transport: read })
  const walletClient = o.privateKey
    ? createWalletClient({ chain, transport: write, account: privateKeyToAccount(o.privateKey) })
    : undefined
  if (walletClient) inFlightOps.set(walletClient, ops)
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

// Arkiv returns at most 100 rows per query (SDK MAX_LIMIT). Reads page after page, each retried
// as a read, until a page covers fewer than 100 matches or maxRows is reached. Skipped rows (did
// not fit the schema) count toward the offset, as the SDK documents.
export async function readAll<T>(
  page: (offset: number) => Promise<{ entities: readonly T[]; skipped: number }>,
  maxRows = 2000,
): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; out.length < maxRows; ) {
    const p = await readWithRetry(() => page(offset))
    out.push(...p.entities)
    const covered = p.entities.length + p.skipped
    if (covered < 100) break
    offset += covered
  }
  return out.slice(0, maxRows)
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
type TxParams = { nonce: number; gasPrice: bigint }

export interface CreateSpec {
  schema: CreateArgs[0]
  values: CreateArgs[1]
  expiration: CreateArgs[2]['expiration']
}

// One signer, one queue: writes from the same wallet run strictly one after another.
const queues = new WeakMap<object, Promise<unknown>>()

function enqueue<T>(wallet: Wallet, job: () => Promise<T>): Promise<T> {
  const before = queues.get(wallet) ?? Promise.resolve()
  const run = before.catch(() => undefined).then(job)
  queues.set(wallet, run)
  return run
}

export function guardedCreate(c: { walletClient: Wallet; publicClient: Reader } & CreateSpec) {
  return enqueue(c.walletClient, () =>
    submitOnce(c.walletClient, c.publicClient, 1, (tx) =>
      c.walletClient.createEntity(c.schema, c.values, { expiration: c.expiration }, tx),
    ),
  )
}

// Deletes one entity our wallet owns, through the same queue and single-submission path.
export function guardedDelete(c: { walletClient: Wallet; publicClient: Reader; entityKey: Hex }) {
  return enqueue(c.walletClient, () =>
    submitOnce(c.walletClient, c.publicClient, 1, (tx) => c.walletClient.deleteEntity({ entityKey: c.entityKey }, tx)),
  )
}

export interface ExtendSpec {
  entityKey: Hex
  expiration: CreateSpec['expiration'] // must not be earlier than the entity's current expiry
}

// Up to MAX_BATCH operations (creates plus expiry extensions) in one transaction, with the gas
// floor scaled by the number of operations. Returns the created keys in the order given.
export const MAX_BATCH = 20

export function guardedBatch(c: { walletClient: Wallet; publicClient: Reader; creates: CreateSpec[]; extensions?: ExtendSpec[] }) {
  const extensions = c.extensions ?? []
  const ops = c.creates.length + extensions.length
  if (ops === 0 || ops > MAX_BATCH) {
    throw new Error(`a batch holds 1 to ${MAX_BATCH} operations, got ${ops}; split it`)
  }
  return enqueue(c.walletClient, () =>
    submitOnce(c.walletClient, c.publicClient, ops, (tx) =>
      c.walletClient.executeBatch(
        {
          creates: c.creates.map((x) => ({ schema: x.schema, values: x.values, expiration: x.expiration })) as never,
          ...(extensions.length ? { extensions } : {}),
        },
        tx,
      ),
    ),
  )
}

async function submitOnce<R extends { txHash: Hex }>(
  wallet: Wallet,
  reader: Reader,
  ops: number,
  send: (tx: TxParams) => Promise<R>,
): Promise<R> {
  let phase: WriteNotVerifiedError['phase'] = 'preflight'
  let txHash: Hex | undefined
  const opsRef = inFlightOps.get(wallet)
  try {
    const address = wallet.account.address
    if ((await reader.getChainId()) !== RABDI_CHAIN_ID) throw new Error('RPC is not Rabdi')
    const nonce = await reader.getTransactionCount({ address, blockTag: 'latest' })
    const gasPrice = await reader.getGasPrice()
    if (opsRef) opsRef.n = ops
    phase = 'submission_unknown'
    const result = await send({ nonce, gasPrice })
    txHash = result.txHash
    phase = 'submitted'
    const receipt = await reader.getTransactionReceipt({ hash: result.txHash })
    if (receipt.status !== 'success') throw new Error(`receipt status is ${receipt.status}`)
    return result
  } catch (err) {
    // A failure before anything was signed is still preflight.
    if (isPermanent(err)) phase = phase === 'submission_unknown' ? 'preflight' : phase
    // The SDK's EntityMutationError carries the hash of a mined but reverted transaction.
    const carried = (err as { txHash?: unknown })?.txHash
    if (!txHash && typeof carried === 'string' && /^0x[0-9a-f]{64}$/i.test(carried)) txHash = carried as Hex
    throw new WriteNotVerifiedError(phase, txHash, rootCause(err))
  } finally {
    if (opsRef) opsRef.n = 1
  }
}
