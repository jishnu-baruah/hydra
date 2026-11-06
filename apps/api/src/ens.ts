// ENS status records (T-A35, spike F4). A team owns status.<app>.eth on ENSv2 (Sepolia) with its own
// PermissionedResolver and grants Hydra's indexer wallet setText for the "hydra.status" key only.
// At every watcher flip the indexer writes match or mismatch there, so anyone can read the verdict
// from ENS without asking Hydra. The write is one transaction, never resent.
import { createPublicClient, createWalletClient, http, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'

export const ENS_STATUS_KEY = 'hydra.status'
const SETTEXT = [{ type: 'function', name: 'setText', stateMutability: 'nonpayable', inputs: [{ type: 'bytes', name: 'name' }, { type: 'string', name: 'key' }, { type: 'string', name: 'value' }], outputs: [] }] as const
const ENTRY = /^([a-z0-9.-]+)=([a-z0-9-]+(?:\.[a-z0-9-]+)+)@(0x[0-9a-fA-F]{40})$/

export interface EnsTarget {
  name: string
  resolver: string
}

// HYDRA_ENS_STATUS: "<domain>=<ens name>@<resolver address>", comma separated.
export function ensStatusTargets(config: string | undefined): Map<string, EnsTarget> {
  const out = new Map<string, EnsTarget>()
  for (const raw of (config ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [domain, rest] = [raw.slice(0, raw.indexOf('=')).toLowerCase(), raw.slice(raw.indexOf('=') + 1)]
    const m = `${domain}=${rest}`.match(ENTRY)
    if (!m) throw new Error(`HYDRA_ENS_STATUS entry "${raw}" is not <domain>=<ens name>@<resolver address>; fix it or unset it`)
    out.set(m[1], { name: m[2], resolver: m[3] })
  }
  return out
}

export const ensStatusValue = (verdict: string): 'match' | 'mismatch' | null =>
  verdict === 'match' || verdict === 'mismatch' ? verdict : null

// Returns a writer for flips, or undefined when nothing is configured. Errors carry no URL or key.
export function ensStatusWriter(o: { config: string | undefined; privateKey: Hex | undefined; rpcUrl?: string }) {
  const targets = ensStatusTargets(o.config)
  if (!targets.size || !o.privateKey) return undefined
  const transport = http(o.rpcUrl ?? 'https://ethereum-sepolia-rpc.publicnode.com', { timeout: 30_000, retryCount: 0 })
  const pub = createPublicClient({ chain: sepolia, transport })
  const wallet = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(o.privateKey) })
  return async (domain: string, verdict: string): Promise<string | null> => {
    const t = targets.get(domain.toLowerCase())
    const value = ensStatusValue(verdict)
    if (!t || !value) return null
    const hash = await wallet.writeContract({ address: t.resolver as Hex, abi: SETTEXT, functionName: 'setText', args: [toHex(packetToBytes(t.name)), ENS_STATUS_KEY, value] })
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
    if (r.status !== 'success') throw new Error(`ENS status write reverted (tx ${hash}); check the indexer still holds the hydra.status grant on ${t.name}`)
    return hash
  }
}
