// ENS status records (T-A35, spike F4) and ENS links from the console (T-A36). A team owns an ENS
// name on ENSv2 (Sepolia) with its own PermissionedResolver. From the console it tags the name with
// its app (text record hydra.app) and grants Hydra's indexer wallet setText for "hydra.status" only,
// in one transaction; the API checks both on chain, then stores the link on Arkiv (hydra.ens). At
// every flip of a linked app the indexer writes match or mismatch there, so anyone can read the
// verdict from ENS without asking Hydra. Each write is one transaction, never resent.
import { createPublicClient, createWalletClient, http, toHex, zeroAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'

// One queue for every Sepolia transaction the indexer wallet sends (status writes and sponsored setups):
// one nonce at a time, so two of them never collide.
let sepoliaTail: Promise<unknown> = Promise.resolve()
export function sepoliaQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = sepoliaTail.catch(() => undefined).then(fn)
  sepoliaTail = run
  return run
}

export const ENS_STATUS_KEY = 'hydra.status'
export const ENS_APP_KEY = 'hydra.app'
export const UNIVERSAL_RESOLVER = '0x24e1d8e068620b647ca097f961a61055f4f42d72' // ENSv2, Sepolia
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const SETTEXT = [{ type: 'function', name: 'setText', stateMutability: 'nonpayable', inputs: [{ type: 'bytes', name: 'name' }, { type: 'string', name: 'key' }, { type: 'string', name: 'value' }], outputs: [] }] as const
const ENTRY = /^([a-z0-9.-]+)=([a-z0-9-]+(?:\.[a-z0-9-]+)+)@(0x[0-9a-fA-F]{40})$/
const NAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

export interface EnsTarget {
  name: string
  resolver: string
}

export const ensNameOk = (name: string): boolean => name.length <= 255 && NAME.test(name)
const dnsName = (name: string): Hex => toHex(packetToBytes(name))

// HYDRA_ENS_STATUS: "<domain>=<ens name>@<resolver address>", comma separated. Names linked from the
// console need no config; this stays for names set up by hand (spikes/F4).
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

// What the chain says about a name a team wants to link to `app`.
export interface EnsLinkFacts {
  app: string
  name: string
  resolver: string | null
  appTag: string | null // the name's hydra.app text record
  hydraCanWrite: boolean // Hydra's indexer may set hydra.status on it
}

// Why the link is refused, or null. Only the name's owner can set hydra.app, so a matching tag proves
// the owner chose this app; the console session has already proved the wallet owns the app.
export function ensLinkProblem(f: EnsLinkFacts): string | null {
  if (!f.resolver || f.resolver.toLowerCase() === zeroAddress) {
    return `${f.name} has no resolver on ENSv2 (Sepolia): register it from the console first, or check the spelling`
  }
  if (f.appTag !== f.app) {
    return `${f.name} does not name ${f.app}: its hydra.app record is ${f.appTag ? `"${f.appTag}"` : 'empty'}. Press Allow Hydra in the console, which sets hydra.app to ${f.app} from the name's owner wallet`
  }
  if (!f.hydraCanWrite) {
    return `Hydra's monitor may not set hydra.status on ${f.name}. Press Allow Hydra in the console, which grants that one record from the name's owner wallet`
  }
  return null
}

// Reads the facts from ENS. `indexer` is the address that will write hydra.status.
export async function ensLinkFacts(o: { name: string; app: string; indexer: Hex; rpcUrl?: string }): Promise<EnsLinkFacts> {
  const pub = createPublicClient({ chain: sepolia, transport: http(o.rpcUrl ?? SEPOLIA_RPC, { timeout: 20_000 }) })
  const resolver = await pub.getEnsResolver({ name: o.name, universalResolverAddress: UNIVERSAL_RESOLVER })
  if (!resolver || resolver === zeroAddress) return { app: o.app, name: o.name, resolver: null, appTag: null, hydraCanWrite: false }
  const appTag = await pub.getEnsText({ name: o.name, key: ENS_APP_KEY, universalResolverAddress: UNIVERSAL_RESOLVER }).catch(() => null)
  const hydraCanWrite = await pub
    .simulateContract({ account: o.indexer, address: resolver, abi: SETTEXT, functionName: 'setText', args: [dnsName(o.name), ENS_STATUS_KEY, 'match'] })
    .then(() => true, () => false)
  return { app: o.app, name: o.name, resolver, appTag: appTag || null, hydraCanWrite }
}

// Returns a writer for flips and for a new link, or undefined without a key. Writes from this wallet run one at a time
// (one nonce at a time), with twice the gas estimate: the estimate is made before the record changes,
// and a match write that followed a mismatch ran out of gas on 7 Nov. Errors carry no URL or key.
export function ensStatusWriter(o: { privateKey: Hex | undefined; rpcUrl?: string }) {
  if (!o.privateKey) return undefined
  const transport = http(o.rpcUrl ?? SEPOLIA_RPC, { timeout: 30_000, retryCount: 0 })
  const pub = createPublicClient({ chain: sepolia, transport })
  const account = privateKeyToAccount(o.privateKey)
  const wallet = createWalletClient({ chain: sepolia, transport, account })
  const write = async (t: EnsTarget, value: 'match' | 'mismatch'): Promise<string> => {
    // The name's resolver now, not the one stored at link time: a team may move its name.
    const current = await pub.getEnsResolver({ name: t.name, universalResolverAddress: UNIVERSAL_RESOLVER })
    if (!current || current === zeroAddress) throw new Error(`${t.name} has no resolver on ENSv2 Sepolia any more; the team must link a name again from the console`)
    const call = { address: current, abi: SETTEXT, functionName: 'setText', args: [dnsName(t.name), ENS_STATUS_KEY, value] } as const
    const estimate = await pub.estimateContractGas({ ...call, account })
    const hash = await wallet.writeContract({ ...call, gas: estimate * 2n > 100_000n ? estimate * 2n : 100_000n })
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
    if (r.status !== 'success') throw new Error(`ENS status write reverted (tx ${hash}); check the indexer still holds the hydra.status grant on ${t.name}`)
    return hash
  }
  return (t: EnsTarget, verdict: string): Promise<string | null> => {
    const value = ensStatusValue(verdict)
    if (!value) return Promise.resolve(null)
    return sepoliaQueue(() => write(t, value))
  }
}
