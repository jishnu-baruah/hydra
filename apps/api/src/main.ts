// Wires real dependencies from the environment and starts the API.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { AlertSubSchema, KeyEpochSchema, LONG, alertSubValues, keyEpochValues, arkivClients, checkProof, guardedBatch, guardedCreate, guardedDelete, recentObservations } from '@hydra/core'
import type { Hex } from 'viem'
import { checkSite } from '@hydra/indexer/check'
import { runOnce, sendTelegram } from '@hydra/indexer/run'
import { privateKeyToAccount } from 'viem/accounts'
import { sitesView, type TargetInfo } from './observations.ts'
import { channelNotifier, deliver, type Channel, type Verdict } from './alerts.ts'
import { chatIdReplies, linkedChats } from './alerts.ts'
import { activity, alertSubs, appForDomainFrom, appsPublishedBy, blockToMs, claimOf, filesByHash, keyVersion, releasesFor } from './reads.ts'
import { createApi, indexerRunner, type AlertRoutes, type ApiDeps, type ConsoleRoutes } from './server.ts'
import { swarmUploader } from './swarm.ts'
import { createWatcher, runOk } from './watch.ts'
import { ensStatusWriter } from './ens.ts'
import { deployDemo, readDemoFiles } from './demo.ts'

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

// Alert channels (T-A30). ALERT_KEY seals each channel's target before it goes to Arkiv; without a
// valid one the routes answer 503 and runs alert only the Hydra team chat. Telegram channels use the
// team bot (TELEGRAM_BOT_TOKEN); its username comes from getMe so the console can name it.
const alertKey = (env.ALERT_KEY ?? '').trim()
const alertKeyOk = /^[0-9a-f]{64}$/i.test(alertKey)
if (env.ALERT_KEY && !alertKeyOk) console.error(`ALERT_KEY must be 64 hex characters (32 bytes); alert channels stay off. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
const tgToken = env.TELEGRAM_BOT_TOKEN
let botName: string | null = null
if (tgToken) {
  fetch(`https://api.telegram.org/bot${tgToken}/getMe`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => r.json() as Promise<{ result?: { username?: unknown } }>)
    .then((j) => {
      if (typeof j.result?.username !== 'string') throw new Error()
      botName = j.result.username
    })
    // No error detail: it could carry the URL, and the token is in it.
    .catch(() => console.error('Telegram getMe failed, so the console will not name the bot; check TELEGRAM_BOT_TOKEN'))
}
// The bot answers "/hydra <app>" and "/chatid" with the chat id (T-A33), read every 3 s. getUpdates
// without an offset consumes nothing, so Find my chat still sees the same messages.
const tgUpdates = async () => {
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/getUpdates?allowed_updates=%5B%22message%22%5D`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  return ((await res?.json().catch(() => null)) as { result?: unknown } | null)?.result
}
if (tgToken) {
  const answered = new Set<number>()
  const since = Date.now()
  let polling = false
  setInterval(async () => {
    if (polling) return
    polling = true
    try {
      for (const r of chatIdReplies(await tgUpdates(), answered, since)) {
        const sent = await sendTelegram({ token: tgToken, chatId: r.chatId, text: r.text })
        if (!sent.ok) console.error(`chat id reply not sent: ${sent.error}`)
      }
    } catch {
      // never let a timer callback reject inside the API process
    } finally {
      polling = false
    }
  }, 3000).unref()
}
const deliverAlert = (ch: Channel, v: Verdict) =>
  deliver(ch, v, { telegram: tgToken ? (chatId, text) => sendTelegram({ token: tgToken, chatId, text }) : undefined })
const alerts: AlertRoutes = {
  key: alertKeyOk ? alertKey : undefined,
  store: walletClient && writer
    ? {
        list: (app) => alertSubs(publicClient, writer, app),
        create: async (app, kind, sealed, createdAt) => ({
          id: (await guardedCreate({ walletClient, publicClient, schema: AlertSubSchema, values: alertSubValues({ app, kind, createdAt, sealed }), expiration: LONG() })).entityKey,
        }),
        remove: async (id) => void (await guardedDelete({ walletClient, publicClient, entityKey: id as Hex })),
      }
    : undefined,
  deliver: deliverAlert,
  bot: () => botName,
  // getUpdates without an offset reads the bot's recent messages and consumes none of them.
  telegramChats: tgToken
    ? async (app: string) => linkedChats(await tgUpdates(), app, Date.now())
    : undefined,
  teamChatId: env.TELEGRAM_CHAT_ID,
}
// Every alert a live indexer run sends also goes to the app's channels, read at most every 30 s.
const notify = alertKeyOk && writer
  ? channelNotifier({ key: alertKey, list: cached(30_000, (app: string) => alertSubs(publicClient, writer, app)), deliver: deliverAlert })
  : undefined

// The indexer runs inside the API with its own wallet, triggered by a scheduled GitHub Actions job.
const indexerKey = env.ARKIV_INDEXER_PRIVATE_KEY as Hex | undefined
const indexer =
  indexerKey && (env.INDEXER_TRIGGER_SECRET ?? '').length >= 32
    ? (() => {
        const clients = arkivClients({ accessKey: env.ARKIV_ACCESS_KEY, privateKey: indexerKey })
        const port = Number(env.PORT ?? env.HYDRA_API_PORT ?? 8787)
        const run = () => runOnce({ api: `http://127.0.0.1:${port}`, clients, notify })
        return { secret: env.INDEXER_TRIGGER_SECRET!, run, runner: indexerRunner(run), runOnly: (domain: string) => runOnce({ api: `http://127.0.0.1:${port}`, clients, only: domain, notify }) }
      })()
    : undefined

// Optional own clock: GitHub's scheduled workflows are unreliable, so the API can start a pass itself
// every INDEXER_INTERVAL_MIN minutes (at least 10) while it is awake. Same guard as the route.
const every = Number(env.INDEXER_INTERVAL_MIN)
if (env.INDEXER_INTERVAL_MIN && !(every >= 10)) {
  console.error('INDEXER_INTERVAL_MIN must be a number of minutes, at least 10; the internal indexer timer is off.')
} else if (indexer?.runner && every >= 10) {
  setInterval(() => {
    const out = indexer.runner.start()
    console.log(out.ok ? 'indexer timer: run started' : `indexer timer: skipped (${out.error})`)
  }, every * 60_000).unref()
}

// The indexed-sites page: the indexer wallet's newest observations joined with the target list.
const indexerAddress = (indexerKey ? privateKeyToAccount(indexerKey).address : env.HYDRA_INDEXER_ADDRESS) as Hex | undefined
const targetsFile = fileURLToPath(new URL('../../../packages/indexer/targets.json', import.meta.url))
let sitesCache: { at: number; body: unknown } | undefined
const sites = async () => {
  if (!indexerAddress) return { summary: null, sites: [] }
  // Cached 30 s: the page polls, and Arkiv reads are the slow part.
  if (sitesCache && Date.now() - sitesCache.at < 30_000) return sitesCache.body
  const { targets } = JSON.parse(await readFile(targetsFile, 'utf8')) as { targets: TargetInfo[] }
  // Observations live 3 days, so that is the window: every domain seen in it is listed.
  const body = sitesView(targets, (await recentObservations(publicClient, indexerAddress, Date.now() - 3 * 86_400_000)) as never)
  sitesCache = { at: Date.now(), body }
  return body
}

// Per-key cache for read routes the extension calls on every page load. Arkiv reads are the slow
// part; the map is capped so hostnames a client invents cannot grow it without limit.
function cached<T>(ttlMs: number, load: (key: string) => Promise<T>, max = 500) {
  const hits = new Map<string, { at: number; value: Promise<T> }>()
  return (key: string): Promise<T> => {
    const hit = hits.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value
    if (hits.size >= max) hits.delete(hits.keys().next().value as string)
    const value = load(key)
    hits.set(key, { at: Date.now(), value })
    value.catch(() => hits.delete(key)) // never keep a failure
    return value
  }
}

// The live demo watcher (T-A25): in-memory, one bound site, a tick every 5 s with no Arkiv traffic.
// A flip runs the normal one-site observation write and Telegram alert, once. The switch is guarded
// by DEMO_WATCH_TOKEN; without it the route answers 503 and says so.
const watchToken = (env.DEMO_WATCH_TOKEN ?? '').length >= 16 ? env.DEMO_WATCH_TOKEN : undefined
if (env.DEMO_WATCH_TOKEN && !watchToken) console.error('DEMO_WATCH_TOKEN must be at least 16 characters; the demo watch switch stays off.')
// ENS status (T-A35): each flip also sets hydra.status on the app's status.<app>.eth, from the
// indexer wallet on Sepolia. It runs after the Arkiv write and on its own, so an ENS failure is logged
// but never fails or repeats the flip.
let ensStatus: ReturnType<typeof ensStatusWriter>
try {
  ensStatus = ensStatusWriter({ config: env.HYDRA_ENS_STATUS, privateKey: indexerKey })
} catch (err) {
  console.error(`${err instanceof Error ? err.message : String(err)}; ENS status writes stay off`)
}
const watcher = writer
  ? createWatcher({
      resolve: async (domain) => {
        const app = await appForDomainFrom(publicClient, writer, domain)
        if (!app) return null
        const manifest = ((await releasesFor(publicClient, writer, app)) as { payload?: { manifest?: unknown } }[])[0]?.payload?.manifest
        return manifest ? { domain, app, manifest } : null
      },
      tick: (t) => checkSite({ ...t, manifest: t.manifest as never }),
      onFlip: async (e) => {
        if (!indexer) throw new Error('no indexer wallet is configured, so no observation or alert can be written')
        const problem = runOk(await indexer.runOnly(e.domain))
        if (problem) throw new Error(problem)
        ensStatus?.(e.domain, e.to).then(
          (tx) => tx && console.log(`ENS status ${e.domain} -> ${e.to} tx ${tx}`),
          (err) => console.error(`ENS status ${e.domain} -> ${e.to} not written: ${err instanceof Error ? (err as { shortMessage?: string }).shortMessage ?? err.message.split('
')[0] : String(err)}`),
        )
      },
    })
  : undefined

// Key versions (T-A32): every key route asks for the app's current version, so it is cached 30 s;
// a rotation clears that app's entry. Reads fail closed: if Arkiv cannot answer, the route fails.
// `rotatedTo` remembers versions written here, so a rotation takes effect before Arkiv's index shows it.
const versions = new Map<string, { at: number; value: Promise<number> }>()
const rotatedTo = new Map<string, number>()
const currentVersion = (app: string): Promise<number> => {
  const hit = versions.get(app)
  if (hit && Date.now() - hit.at < 30_000) return hit.value
  if (versions.size >= 500) versions.delete(versions.keys().next().value as string)
  const value = keyVersion(publicClient, writer!, app).then((v) => Math.max(v, rotatedTo.get(app) ?? 0))
  versions.set(app, { at: Date.now(), value })
  value.catch(() => versions.delete(app))
  return value
}
const consoleRoutes: ConsoleRoutes | undefined = walletClient && writer
  ? {
      apps: async (address) =>
        Promise.all((await appsPublishedBy(publicClient, writer, address)).map(async (a) => ({ app: a.app, created_at: a.created_at, expires_at: await blockToMs(publicClient, a.expires_block) }))),
      rotate: async (app, by) => {
        const version = Math.max(await keyVersion(publicClient, writer, app), rotatedTo.get(app) ?? 0) + 1 // fresh read, not the cache
        await guardedCreate({ walletClient, publicClient, schema: KeyEpochSchema, values: keyEpochValues({ app, version, createdAt: Date.now(), payload: { by: by.toLowerCase() } }), expiration: LONG() })
        rotatedTo.set(app, version)
        versions.delete(app)
        return { version }
      },
      rotationsPerHour: 10,
    }
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
        proveDomain: (d, app) => checkProof(d, app),
      }
    : undefined,
  claimOf: writer ? (app) => claimOf(publicClient, writer, app) : undefined,
  allowedAddresses: allow.length ? new Set(allow) : undefined,
  publishesPerHour: env.HYDRA_PUBLISHES_PER_HOUR ? Number(env.HYDRA_PUBLISHES_PER_HOUR) : undefined,
  releasesFor: async (app) => (writer ? releasesFor(publicClient, writer, app) : []),
  filesByHash: async (sha) => (writer ? filesByHash(publicClient, writer, sha) : []),
  appForDomain: writer ? cached(30_000, (d: string) => appForDomainFrom(publicClient, writer, d)) : undefined,
  indexer,
  watch: watcher ? { watcher, token: watchToken } : undefined,
  demo: {
    deploy: env.VERCEL_TOKEN
      ? async (kind) =>
          deployDemo(kind, {
            token: env.VERCEL_TOKEN!,
            project: { name: 'hydra-demo-dapp', projectId: env.VERCEL_DEMO_PROJECT ?? 'prj_H6fU06xNrnyBAcUL3HmEfCSKhaPW', teamId: env.VERCEL_TEAM ?? 'team_rnIa7yXZrd6PhH4sJINfwVuI' },
            files: await readDemoFiles(fileURLToPath(new URL('../../../demo/', import.meta.url))),
          })
      : undefined,
  },
  observations: sites,
  alerts,
  keyVersion: writer ? currentVersion : undefined,
  console: consoleRoutes,
  activity: async () => (writer ? activity(publicClient, writer) : { head: null, events: [] }),
  health: { watch: Boolean(watcher && watchToken), publisherWallet: walletClient?.account.address ?? null, accessKey: Boolean(env.ARKIV_ACCESS_KEY), indexer: Boolean(indexer), alerts: Boolean(alerts.key && alerts.store) },
}

const port = Number(env.PORT ?? env.HYDRA_API_PORT ?? 8787)
createApi(deps).listen(port, () => console.log(`hydra api on :${port}`))
