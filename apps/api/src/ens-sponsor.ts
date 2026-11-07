// One-click ENS setup (T-A37). The app's owner presses one button in the console and Hydra's indexer
// wallet pays for everything, so the team signs no transaction: it deploys a PermissionedResolver,
// tags it with the app, leaves Hydra only the hydra.status setter grant and hands every other role to
// the team, then registers <app>.eth to the team on ENSv2 (Sepolia) and links it. Each transaction is
// sent once and waited for, never resent; a failed step fails the job and says what to do next.
// The pure parts (steps, job registry, limits) take the chain actions as an injected object so tests
// use fakes; realSponsorActions holds the viem calls.
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseEventLogs, toHex, zeroAddress, zeroHash, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rootCause } from '@hydra/core'
import { ENS_APP_KEY, ENS_STATUS_KEY, sepoliaQueue } from './ens.ts'

export const STEP_LABELS = [
  '1 of 6 deploying the resolver',
  '2 of 6 setting up the resolver and its permissions',
  '3 of 6 paying the registration fee',
  '4 of 6 committing to the name',
  '5 of 6 registering the name (this waits about a minute)',
  '6 of 6 checking the name and linking it',
] as const

// ENS labels: no leading or trailing hyphen, and no "--" at positions 3 and 4 (reserved, e.g. xn--).
const LABEL = /^(?!-)(?!..--)[a-z0-9-]{3,40}(?<!-)$/
export const sponsorLabelProblem = (label: string): string | null =>
  LABEL.test(label) ? null : `${label}.eth is taken or too short: register a different name yourself in the console, or use a name you own`

export interface SponsorActions {
  isAvailable: (label: string) => Promise<boolean>
  deployResolver: () => Promise<{ tx: string; resolver: string }>
  configureResolver: (o: { resolver: string; label: string; app: string; team: string }) => Promise<string>
  prepareFee: (o: { label: string }) => Promise<string[]> // mint test USDC to Hydra, approve the registrar
  commit: (o: { label: string; team: string; resolver: string; secret: string }) => Promise<string>
  waitCommitment: () => Promise<void>
  register: (o: { label: string; team: string; resolver: string; secret: string }) => Promise<string>
  verifyAndLink: (o: { app: string; name: string; team: string }) => Promise<{ name: string; resolver: string }>
}

export interface SponsorJob {
  state: 'none' | 'running' | 'done' | 'failed'
  step: string | null
  name: string | null
  error: string | null
  txs: string[]
}

export type StartResult = { ok: true; step: string } | { ok: false; problem: string }

export function createSponsor(o: { actions: SponsorActions; now?: () => number; perWallet?: number; perDay?: number }) {
  const now = o.now ?? Date.now
  const perWallet = o.perWallet ?? 3
  const perDay = o.perDay ?? 20
  const DAY = 86_400_000
  const jobs = new Map<string, SponsorJob>()
  const starts: { owner: string; at: number }[] = []

  const status = (app: string): SponsorJob => {
    const j = jobs.get(app)
    return j ? { ...j, txs: [...j.txs] } : { state: 'none', step: null, name: null, error: null, txs: [] }
  }

  async function run(app: string, team: string, job: SponsorJob) {
    const label = app
    const at = (i: number) => {
      job.step = STEP_LABELS[i]
    }
    try {
      const free = await o.actions.isAvailable(label)
      if (!free) {
        job.state = 'failed'
        job.error = `${label}.eth is taken or too short: register a different name yourself in the console, or use a name you own`
        return
      }
      at(0)
      const { tx, resolver } = await o.actions.deployResolver()
      job.txs.push(tx)
      at(1)
      job.txs.push(await o.actions.configureResolver({ resolver, label, app, team }))
      at(2)
      job.txs.push(...(await o.actions.prepareFee({ label })))
      at(3)
      const secret = toHex(randomBytes(32))
      job.txs.push(await o.actions.commit({ label, team, resolver, secret }))
      at(4)
      await o.actions.waitCommitment()
      job.txs.push(await o.actions.register({ label, team, resolver, secret }))
      at(5)
      const linked = await o.actions.verifyAndLink({ app, name: `${label}.eth`, team })
      job.name = linked.name
      job.step = null
      job.state = 'done'
    } catch (err) {
      job.state = 'failed'
      const cause = rootCause(err)
      job.error = `${job.step ?? 'checking the name'} failed: ${cause}. The failed step was not retried, so no fee was paid twice. Check the transactions listed, then register ${label}.eth yourself in the console, or ask the Hydra team to look`
    }
  }

  function start(app: string, team: string): StartResult {
    const bad = sponsorLabelProblem(app)
    if (bad) return { ok: false, problem: bad }
    const prev = jobs.get(app)
    if (prev && (prev.state === 'running' || prev.state === 'done'))
      return { ok: false, problem: prev.state === 'running' ? `a setup for ${app} is already running: wait for it to finish` : `${app} already has its ENS setup (${prev.name}): there is only one per app` }
    const t = now()
    while (starts.length && t - starts[0].at >= DAY) starts.shift()
    const mine = starts.filter((s) => s.owner === team.toLowerCase()).length
    if (mine >= perWallet) return { ok: false, problem: `this wallet has used its ${perWallet} sponsored setups per wallet for today: register the name yourself in the console, or try again tomorrow` }
    if (starts.length >= perDay) return { ok: false, problem: `Hydra has paid for ${perDay} sponsored setups per day and the limit is reached: register the name yourself in the console, or try again tomorrow` }
    starts.push({ owner: team.toLowerCase(), at: t })
    const job: SponsorJob = { state: 'running', step: STEP_LABELS[0], name: null, error: null, txs: [] }
    jobs.set(app, job)
    void run(app, team, job)
    return { ok: true, step: STEP_LABELS[0] }
  }

  return { start, status }
}

// ---- real chain actions (viem, ENSv2 on Sepolia; addresses from spikes/F4/spike.mjs) ----
const A = {
  registrar: '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3',
  resolverImpl: '0x115eb53f0c60696633855f90b138178fb40b2b2c',
  factory: '0xda70306c98e97ece36f997a21368e53298572991',
  usdc: '0x240b0316df57887dbbe58b586508b19e633a14aa',
} as const
const ALL_ROLES = BigInt('0x' + '11'.repeat(32))
const abi = (n: string) => JSON.parse(readFileSync(new URL(`../../../spikes/F4/abi/${n}.json`, import.meta.url), 'utf8')).abi
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

// The multicall run once on the new resolver, from Hydra. Order matters: the team gets its roles
// before Hydra gives up its own.
export function resolverSetupCalls(o: { label: string; app: string; team: Hex; hydra: Hex }): Hex[] {
  const res = abi('PermissionedResolver')
  const enc = (functionName: string, args: unknown[]) => encodeFunctionData({ abi: res, functionName, args })
  const dns = toHex(packetToBytes(`${o.label}.eth`))
  return [
    enc('setText', [dns, ENS_APP_KEY, o.app]),
    enc('grantSetterRoles', [enc('setText', ['0x', ENS_STATUS_KEY, '']), o.hydra]),
    enc('grantRootRoles', [ALL_ROLES, o.team]),
    enc('revokeRootRoles', [ALL_ROLES, o.hydra]),
  ]
}

export function realSponsorActions(o: {
  privateKey: Hex
  link: (app: string, name: string, by: string) => Promise<{ name: string; resolver: string } | { problem: string }>
  rpcUrl?: string
}): SponsorActions {
  const transport = http(o.rpcUrl ?? SEPOLIA_RPC, { timeout: 30_000, retryCount: 0 })
  const pub = createPublicClient({ chain: sepolia, transport })
  const account = privateKeyToAccount(o.privateKey)
  const wallet = createWalletClient({ chain: sepolia, transport, account })
  const reg = abi('ETHRegistrar')
  const res = abi('PermissionedResolver')
  // Sends once, logs the hash, waits for the receipt. Never resends.
  const tx = (what: string, send: () => Promise<Hex>) => {
    return sepoliaQueue(async () => {
      const hash = await send()
      console.log(`ENS sponsor ${what} tx ${hash}`)
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
      if (r.status !== 'success') throw new Error(`${what} reverted (tx ${hash})`)
      return r
    })
  }
  const duration = () => pub.readContract({ address: A.registrar, abi: reg, functionName: 'MIN_REGISTER_DURATION' }) as Promise<bigint>
  const commitArgs = async (x: { label: string; team: string; resolver: string; secret: string }) =>
    [x.label, x.team, x.secret, zeroAddress, x.resolver, await duration(), zeroHash] as const
  return {
    isAvailable: async (label) => (await pub.readContract({ address: A.registrar, abi: reg, functionName: 'isAvailable', args: [label] })) as boolean,
    deployResolver: async () => {
      const salt = BigInt(keccak256(toHex(randomBytes(32))))
      const data = encodeFunctionData({ abi: res, functionName: 'initialize', args: [[{ account: account.address, roleBitmap: ALL_ROLES }], []] })
      const r = await tx('deploy resolver', () => wallet.writeContract({ address: A.factory, abi: abi('VerifiableFactory'), functionName: 'deployProxy', args: [A.resolverImpl, salt, data] }))
      const log = parseEventLogs({ abi: abi('VerifiableFactory'), logs: r.logs, eventName: 'ProxyDeployed' })[0] as { args: { proxyAddress: string } } | undefined
      if (!log) throw new Error(`the factory emitted no ProxyDeployed event (tx ${r.transactionHash})`)
      return { tx: r.transactionHash, resolver: log.args.proxyAddress }
    },
    configureResolver: async (x) => {
      const calls = resolverSetupCalls({ label: x.label, app: x.app, team: x.team as Hex, hydra: account.address })
      const r = await tx('configure resolver', () => wallet.writeContract({ address: x.resolver as Hex, abi: res, functionName: 'multicall', args: [calls] }))
      return r.transactionHash
    },
    prepareFee: async (x) => {
      const [base, premium] = (await pub.readContract({ address: A.registrar, abi: reg, functionName: 'getRegisterPrice', args: [x.label, await duration(), A.usdc] })) as [bigint, bigint]
      const fee = (base + premium) * 2n
      const m = await tx('mint test USDC', () => wallet.writeContract({ address: A.usdc, abi: abi('MockUSDC'), functionName: 'mint', args: [account.address, fee] }))
      const a = await tx('approve registrar', () => wallet.writeContract({ address: A.usdc, abi: abi('MockUSDC'), functionName: 'approve', args: [A.registrar, fee] }))
      return [m.transactionHash, a.transactionHash]
    },
    commit: async (x) => {
      const commitment = await pub.readContract({ address: A.registrar, abi: reg, functionName: 'makeCommitment', args: await commitArgs(x) })
      return (await tx('commit', () => wallet.writeContract({ address: A.registrar, abi: reg, functionName: 'commit', args: [commitment] }))).transactionHash
    },
    waitCommitment: async () => {
      const age = Number(await pub.readContract({ address: A.registrar, abi: reg, functionName: 'MIN_COMMITMENT_AGE' }))
      await new Promise((r) => setTimeout(r, (age + 5) * 1000))
    },
    register: async (x) =>
      (await tx('register', async () => wallet.writeContract({ address: A.registrar, abi: reg, functionName: 'register', args: [x.label, x.team, x.secret, zeroAddress, x.resolver, await duration(), A.usdc, zeroHash] }))).transactionHash,
    verifyAndLink: async (x) => {
      const out = await o.link(x.app, x.name, x.team)
      if ('problem' in out) throw new Error(out.problem)
      return out
    },
  }
}
