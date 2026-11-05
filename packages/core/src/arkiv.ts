import { createPublicClient, createWalletClient } from '@arkiv-network/sdk'
import { rabdi } from '@arkiv-network/sdk/chains'
import { http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Rabdi testnet clients. The access key lifts the public RPC's rate limit; `rpcUrl` overrides the
// transport (tests point it at a closed port).
export function arkivClients(o: { accessKey?: string; privateKey?: Hex; rpcUrl?: string }) {
  const chain = rabdi({ accessKey: o.accessKey ?? '' })
  const transport = http(o.rpcUrl)
  const publicClient = createPublicClient({ chain, transport })
  const walletClient = o.privateKey
    ? createWalletClient({ chain, transport, account: privateKeyToAccount(o.privateKey) })
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
])

export const isPermanent = (err: unknown): boolean =>
  err instanceof Error && PERMANENT.has(err.name)

// viem wraps a revert about six errors deep; the useful line is the innermost cause.
export function rootCause(err: unknown): string {
  let e: unknown = err
  while (e instanceof Error && e.cause instanceof Error) e = e.cause
  return e instanceof Error ? e.message : String(e)
}

// Retries transient failures (network, RPC rate limits) up to `tries` times with backoff.
// For a create, pass a fixed `salt` so a retry of a write that did land targets the same entity key
// and fails instead of writing a duplicate.
export async function withRetry<T>(
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
  throw new Error(`Arkiv call failed: ${rootCause(last)}`, { cause: last })
}
