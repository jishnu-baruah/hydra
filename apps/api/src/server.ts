// HTTP routes. Dependencies are injected so tests run without a network or keys.
//
//   GET  /health
//   GET  /publish.mjs                  the CI publish script
//   GET  /v1/auth/message?address=&app= the exact message to sign
//   POST /v1/auth/key                  { address, app, issuedAt, signature } -> { apiKey }
//   POST /v1/releases                  Authorization: Bearer <apiKey>
//   GET  /v1/apps/:app/releases
//   GET  /v1/files/:sha256
//   GET  /v1/domains/:hostname
//   POST /v1/indexer/run              Authorization: Bearer <INDEXER_TRIGGER_SECRET>; starts one pass, 202
//   GET  /v1/indexer/status           { running, startedAt, finishedAt, last }; public
//   GET  /v1/observations             every indexed site with its latest observation and recent history
//   GET  /v1/activity                 everything our wallet wrote, newest block first
//   GET  /v1/alerts                   Authorization: Bearer <apiKey>; the key's app's alert channels (T-A30)
//   POST /v1/alerts                   { kind, target }; tests the target, then stores it sealed
//   POST /v1/alerts/:id/test          sends a test message
//   DELETE /v1/alerts/:id
//   GET  /v1/alerts/telegram-bot      { username } of the bot to add to a Telegram chat; public
//   GET  /v1/console/message?address= the exact text a wallet signs for a console session (T-A32)
//   POST /v1/console/session          { address, issuedAt, signature } -> { session, address, expires }
//   GET  /v1/console/apps             Authorization: Bearer <session>; every app this wallet owns
//   POST /v1/console/apps/:app/rotate a new API key; older keys of the app stop working
//   .../apps/:app/alerts, /alerts/:id, /alerts/:id/test, /telegram-chats   the /v1/alerts routes, by session

import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { normalizeDomain, rootCause, WriteNotVerifiedError } from '@hydra/core'
import { APP_NAME, checkInput, keyFromSignature, signInMessage } from './auth.ts'
import { ADDRESS, consoleMessage, sessionFromSignature, verifySession } from './console.ts'
import { issueKey, KEY_TTL_MS, verifyKey, type KeyClaims } from './keys.ts'
import { claimApp, ownedError, publish, type PublishDeps } from './publish.ts'
import type { createWatcher } from './watch.ts'
import { checkTarget, label, newSecret, openChannel, seal, testVerdict, type Channel, type Sent, type StoredSub, type Verdict } from './alerts.ts'

// Alert channels (T-A30). `key` is ALERT_KEY (64 hex); `store` is the Arkiv side, absent without a
// funded writer wallet. Either missing: the routes answer 503 and say which.
export interface AlertRoutes {
  key?: string
  store?: {
    list: (app: string) => Promise<StoredSub[]> // our wallet's hydra.alert_sub rows for this app
    create: (app: string, kind: string, sealed: Uint8Array, createdAt: number) => Promise<{ id: string }>
    remove: (id: string) => Promise<void>
  }
  deliver: (ch: Channel, v: Verdict) => Promise<Sent>
  bot?: () => string | null // the Telegram bot's username, from getMe at startup
  telegramChats?: (app: string) => Promise<{ id: string; title: string }[]> // chats that sent "/hydra <app>" recently
  teamChatId?: string // the Hydra team chat (TELEGRAM_CHAT_ID): never a team's channel
  writesPerHour?: number // per app; default 20
  maxChannels?: number // per app; default 5
}

// Console (T-A32): which apps a wallet may own, and the key rotation write. Absent without a funded
// Arkiv writer wallet; the console routes then answer 503.
export interface ConsoleRoutes {
  apps: (address: string) => Promise<{ app: string; created_at: number; expires_at: number }[]> // candidates: apps created for this wallet
  rotate: (app: string, by: string) => Promise<{ version: number }> // stores the next key version and clears the cache
  rotationsPerHour?: number // per app; default 10
}

export interface ApiDeps {
  secret: string
  corsOrigin?: string
  publishScript?: () => Promise<string>
  publish?: PublishDeps // undefined: no funded Arkiv wallet configured
  claimOf?: (app: string) => Promise<{ owner: string; key: `0x${string}` } | null> // live claim, or null
  allowedAddresses?: Set<string> // lowercased; when set, only these may get keys and publish
  publishesPerHour?: number // per address; default 30
  claimsPerHour?: number // new app names reserved per address; default 5
  releasesFor?: (app: string) => Promise<unknown>
  filesByHash?: (sha256: string) => Promise<unknown>
  // The app that proved this hostname (hydra.txt at publish), or null.
  appForDomain?: (domain: string) => Promise<string | null>
  activity?: () => Promise<unknown>
  observations?: () => Promise<unknown>
  indexer?: { secret: string; run: () => Promise<RunSummary>; runner?: IndexerRunner } // trigger; spends indexer gas
  // The demo watcher: GET is public status, POST switches it, guarded by a bearer token.
  watch?: { watcher: ReturnType<typeof createWatcher>; token?: string }
  // Hack and Fix buttons (T-A27): redeploys the demo site; guarded by the watch token. Absent without VERCEL_TOKEN.
  demo?: { deploy?: (kind: 'hack' | 'fix') => Promise<unknown> }
  alerts?: AlertRoutes
  // The app's current key version (0 when never rotated). Keys issued under a lower one are refused.
  keyVersion?: (app: string) => Promise<number>
  console?: ConsoleRoutes
  health?: Record<string, unknown>
}

export interface RunSummary {
  sites: number
  written: number
  txs: string[]
  errors: string[]
  lines: string[]
  ms: number
  skipped?: unknown
}

export type StartResult = { ok: true; startedAt: number } | { ok: false; status: 409 | 429; error: string }
export type IndexerRunner = ReturnType<typeof indexerRunner>

// One guard for the route and the timer: a pass spends gas, so one at a time and at most once every
// 5 minutes. start() returns at once; the pass continues and its outcome lands in status().
export function indexerRunner(run: () => Promise<RunSummary>, now: () => number = Date.now) {
  let running = false
  let startedAt: number | null = null
  let finishedAt: number | null = null
  let last: RunSummary | null = null
  const start = (): StartResult => {
    if (running) return { ok: false, status: 409, error: 'an indexer run is already in progress; poll /v1/indexer/status' }
    if (startedAt !== null && now() - startedAt < 5 * 60_000) {
      return { ok: false, status: 429, error: 'the indexer ran less than 5 minutes ago; read /v1/indexer/status or retry later' }
    }
    running = true
    const t0 = now()
    startedAt = t0
    // A run that never settles (a socket that never errors) must not hold the busy flag forever.
    let timer: ReturnType<typeof setTimeout> | undefined
    const cap = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('the run took over 40 minutes and was abandoned')), 40 * 60_000)
    })
    Promise.race([run(), cap])
      .then((s) => { last = s })
      .catch((err) => {
        last = { sites: 0, written: 0, txs: [], errors: [`indexer run failed: ${rootCause(err)}. Check the API logs and rerun`], lines: [], ms: now() - t0 }
      })
      .finally(() => {
        clearTimeout(timer)
        finishedAt = now()
        running = false
      })
    return { ok: true, startedAt: t0 }
  }
  return { start, status: () => ({ running, startedAt, finishedAt, last }) }
}

const SMALL = 16 * 1024
const LARGE = 25 * 1024 * 1024

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, `body over ${limit} bytes`)
    chunks.push(chunk as Buffer)
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v
  } catch {
    throw new HttpError(400, 'body must be a JSON object')
  }
}

export function createApi(deps: ApiDeps) {
  // Every publish spends the server wallet's gas and the postage batch, so access is limited:
  // an optional allowlist, app names owned by their first publisher, and a per-address rate.
  // A key reserves its app name on Arkiv at once (one write), so key requests are limited too.
  const allowed = (address: string) => !deps.allowedAddresses || deps.allowedAddresses.has(address.toLowerCase())
  const limiter = (perHour: number) => {
    const recent = new Map<string, number[]>()
    return (address: string, now = Date.now()) => {
      const key = address.toLowerCase()
      const times = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000)
      if (times.length >= perHour) return false
      recent.set(key, [...times, now])
      return true
    }
  }
  const takeSlot = limiter(deps.publishesPerHour ?? 30)
  const takeClaim = limiter(deps.claimsPerHour ?? 5)
  const takeAlertWrite = limiter(deps.alerts?.writesPerHour ?? 20)
  const takeRotation = limiter(deps.console?.rotationsPerHour ?? 10)

  // The indexer trigger spends gas, so it needs its own secret and the shared runner guard.
  const runner = deps.indexer ? (deps.indexer.runner ?? indexerRunner(deps.indexer.run)) : undefined
  const triggerOk = (auth: string | undefined) => {
    const want = Buffer.from(`Bearer ${deps.indexer?.secret ?? ''}`)
    const got = Buffer.from(auth ?? '')
    return Boolean(deps.indexer?.secret) && got.length === want.length && timingSafeEqual(got, want)
  }

  const watchOk = (auth: string | undefined) => {
    const want = Buffer.from(`Bearer ${deps.watch?.token ?? ''}`)
    const got = Buffer.from(auth ?? '')
    return Boolean(deps.watch?.token) && got.length === want.length && timingSafeEqual(got, want)
  }

  const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': deps.corsOrigin ?? '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  const bearer = (req: IncomingMessage) => {
    const auth = req.headers.authorization ?? ''
    return auth.startsWith('Bearer ') ? auth.slice(7) : undefined
  }

  // A hyd_ key that is valid and not older than the app's current key version. Sends the 401 itself.
  const keyAuth = async (req: IncomingMessage, res: ServerResponse, missing: string): Promise<KeyClaims | null> => {
    const claims = verifyKey(deps.secret, bearer(req))
    if (!claims) {
      send(res, 401, { error: missing })
      return null
    }
    if (deps.keyVersion && (claims.v ?? 0) < (await deps.keyVersion(claims.app))) {
      send(res, 401, { error: 'this key was replaced by a newer one: use the latest key from the console, or rotate again' })
      return null
    }
    return claims
  }

  // A console session. Sends the 401 or 403 itself.
  const sessionAuth = (req: IncomingMessage, res: ServerResponse) => {
    const claims = verifySession(deps.secret, bearer(req))
    if (!claims) {
      send(res, 401, { error: 'missing, invalid or expired console session; sign in again at the console' })
      return null
    }
    if (!allowed(claims.address)) {
      send(res, 403, { error: 'this address is no longer allowlisted' })
      return null
    }
    return claims
  }

  // The chats a team can add: where someone sent "/hydra <app>" to the bot in the last 15 minutes.
  const telegramChats = async (res: ServerResponse, app: string) => {
    const a = deps.alerts
    const chats = a?.telegramChats ? (await a.telegramChats(app)).filter((c) => c.id !== a.teamChatId) : []
    return send(res, 200, { app, chats })
  }

  // The channel routes, shared by key auth (/v1/alerts) and session auth (/v1/console/apps/:app/alerts).
  // `keyAddress` is set for a key: it outlives a lapsed name claim, so if someone else holds the name
  // now the key is stale. A session has proved ownership of `app` before it gets here.
  const alertOps = async (req: IncomingMessage, res: ServerResponse, o: { app: string; keyAddress?: string; id?: string; isTest?: boolean }) => {
    const { app, id, isTest } = o
    const method = req.method ?? ''
    const a = deps.alerts
    if (!a?.key) return send(res, 503, { error: 'alert channels are off on this server: the operator must set ALERT_KEY (64 hex characters)' })
    if (!a.store) return send(res, 503, { error: 'alert channels are off on this server: no funded Arkiv writer wallet (ARKIV_PRIVATE_KEY) is configured' })
    const { key, store } = a
    if (o.keyAddress) {
      const owner = deps.claimOf ? (await deps.claimOf(app))?.owner ?? null : null
      if (owner && owner !== o.keyAddress.toLowerCase()) return send(res, 403, { error: ownedError(app, owner) })
    }
    if (method !== 'GET' && !takeAlertWrite(app)) return send(res, 429, { error: 'alert channel change limit reached for this app; try again within the hour' })
    const subs = await store.list(app)

    if (!id && method === 'GET') return send(res, 200, { app, channels: describe(subs, app, key) })

    if (!id) {
      const body = await readJson(req, SMALL)
      const t = checkTarget(body.kind, body.target)
      if (!t.ok) return send(res, 400, { error: t.error })
      if (t.value.kind === 'telegram') {
        if (a.teamChatId && t.value.target === a.teamChatId) return send(res, 400, { error: 'that is the Hydra team chat; add a group of your own' })
        const linked = a.telegramChats ? await a.telegramChats(app) : []
        const bot = a.bot?.() ? `@${a.bot()}` : 'the Hydra bot'
        if (!linked.some((c) => c.id === t.value.target)) return send(res, 400, { error: `prove the chat is yours: in that chat send "/hydra ${app}" to ${bot}, then add it again within 15 minutes` })
      }
      const max = a.maxChannels ?? 5
      if (subs.length >= max) return send(res, 409, { error: `this app already has ${max} alert channels; delete one first` })
      const ch: Channel = { ...t.value, ...(t.value.kind === 'webhook' ? { secret: newSecret() } : {}) }
      // A target that cannot take a message is not stored.
      const r = await a.deliver(ch, testVerdict(app))
      if (!r.ok) return send(res, 502, { error: `the test message failed: ${r.error}. Nothing was saved` })
      const sealed = seal(JSON.stringify({ app, target: ch.target, ...(ch.secret ? { secret: ch.secret } : {}) }), key)
      const out = await store.create(app, ch.kind, sealed, Date.now())
      // The webhook secret is shown here once and never again.
      return send(res, 201, { id: out.id, kind: ch.kind, label: label(ch.kind, ch.target), ...(ch.secret ? { secret: ch.secret } : {}) })
    }

    const sub = subs.find((s) => s.id.toLowerCase() === id.toLowerCase())
    if (!sub) return send(res, 404, { error: `no alert channel ${id} for app ${app}; list them with GET /v1/alerts` })
    if (isTest) {
      const ch = openChannel(sub, app, key)
      if (!ch) return send(res, 409, { error: 'this channel did not open (ALERT_KEY changed?); delete it and add it again' })
      const r = await a.deliver(ch, testVerdict(app))
      return r.ok ? send(res, 200, { sent: true }) : send(res, 502, { error: r.error })
    }
    await store.remove(sub.id)
    return send(res, 200, { deleted: sub.id })
  }

  // An app's channels as the API shows them: labels only, oldest first.
  const describe = (subs: StoredSub[], app: string, key: string) =>
    subs
      .map((s) => {
        const ch = openChannel(s, app, key)
        return { id: s.id, kind: s.kind, label: ch ? label(ch.kind, ch.target) : 'unreadable (ALERT_KEY changed?); delete it and add it again', created_at: s.created_at }
      })
      .sort((x, y) => x.created_at - y.created_at)

  // Strict: only the owner of the earliest live claim. An unclaimed or lapsed name is nobody's.
  const owns = async (app: string, address: string) => (deps.claimOf ? (await deps.claimOf(app))?.owner === address.toLowerCase() : false)

  return createServer(async (req, res) => {
    const started = Date.now()
    const url = new URL(req.url ?? '/', 'http://local')
    const path = url.pathname
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '')

      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true, arkivWrites: Boolean(deps.publish), swarm: Boolean(deps.publish?.swarm), ...deps.health })
      }

      if (req.method === 'GET' && path === '/publish.mjs' && deps.publishScript) {
        return send(res, 200, await deps.publishScript(), 'text/javascript; charset=utf-8')
      }

      if (req.method === 'GET' && path === '/v1/auth/message') {
        const input = checkInput(url.searchParams.get('address'), url.searchParams.get('app'))
        if (!input.ok) return send(res, input.status, { error: input.error })
        const issuedAt = new Date().toISOString()
        return send(res, 200, { message: signInMessage(input.value.address, input.value.app, issuedAt), issuedAt, ...input.value })
      }

      if (req.method === 'POST' && path === '/v1/auth/key') {
        const out = await keyFromSignature(deps.secret, await readJson(req, SMALL), Date.now(), deps.keyVersion)
        if (!out.ok) return send(res, out.status, { error: out.error })
        if (!allowed(out.value.address)) return send(res, 403, { error: 'this test server only issues keys to allowlisted addresses' })
        const { address, app } = out.value
        const owner = deps.claimOf ? (await deps.claimOf(app))?.owner ?? null : null
        if (owner && owner !== address.toLowerCase()) return send(res, 403, { error: ownedError(app, owner) })
        // Unclaimed: reserve the name now, so nobody can take it between key and first publish.
        let claimTx: string | null = null
        if (!owner && deps.claimOf && deps.publish) {
          if (!takeClaim(address)) return send(res, 429, { error: 'too many new app names for this address; try again within the hour' })
          claimTx = (await claimApp(deps.publish, app, address, Date.now())).txHash
        }
        return send(res, 200, { ...out.value, claimTx })
      }

      if (req.method === 'POST' && path === '/v1/releases') {
        const claims = await keyAuth(req, res, 'missing or invalid API key; get one from the Hydra site')
        if (!claims) return
        if (!allowed(claims.address)) return send(res, 403, { error: 'this address is no longer allowlisted' })
        if (!deps.publish) return send(res, 503, { error: 'publishing is not configured on this server (no funded Arkiv wallet)' })
        const body = await readJson(req, LARGE)
        if (!takeSlot(claims.address)) return send(res, 429, { error: 'publish limit reached for this address; try again within the hour' })
        const out = await publish(claims, body, { ...deps.publish, claimOf: deps.claimOf })
        return out.ok ? send(res, 201, out.value) : send(res, out.status, { error: out.error })
      }

      if (req.method === 'GET' && path === '/v1/alerts/telegram-bot') {
        return send(res, 200, { username: deps.alerts?.bot?.() ?? null })
      }

      if (req.method === 'GET' && path === '/v1/alerts/telegram-chats') {
        const claims = await keyAuth(req, res, 'missing or invalid API key; get one for your app from the Hydra site')
        return claims ? telegramChats(res, claims.app) : undefined
      }

      const alertRoute = /^\/v1\/alerts(?:\/(0x[0-9a-fA-F]{64})(\/test)?)?$/.exec(path)
      if (alertRoute) {
        const [, id, isTest] = alertRoute
        const method = req.method ?? ''
        const known = id ? (isTest ? method === 'POST' : method === 'DELETE') : method === 'GET' || method === 'POST'
        if (!known) return send(res, 405, { error: `${method} is not supported on ${path}` })
        const claims = await keyAuth(req, res, 'missing or invalid API key; get one for your app from the Hydra site')
        if (!claims) return
        if (!allowed(claims.address)) return send(res, 403, { error: 'this address is no longer allowlisted' })
        return alertOps(req, res, { app: claims.app, keyAddress: claims.address, id, isTest: Boolean(isTest) })
      }

      if (req.method === 'GET' && path === '/v1/console/message') {
        const address = url.searchParams.get('address') ?? ''
        if (!ADDRESS.test(address)) return send(res, 400, { error: 'address must be 0x followed by 40 hex characters' })
        const issuedAt = new Date().toISOString()
        return send(res, 200, { message: consoleMessage(address, issuedAt), issuedAt })
      }

      if (req.method === 'POST' && path === '/v1/console/session') {
        const out = await sessionFromSignature(deps.secret, await readJson(req, SMALL))
        if (!out.ok) return send(res, out.status, { error: out.error })
        if (!allowed(out.value.address)) return send(res, 403, { error: 'this test server only opens console sessions for allowlisted addresses' })
        return send(res, 200, out.value)
      }

      const consoleRoute = /^\/v1\/console\/apps(?:\/([a-z0-9-]+)(?:\/(rotate|telegram-chats|alerts)(?:\/(0x[0-9a-fA-F]{64})(\/test)?)?)?)?$/.exec(path)
      if (consoleRoute) {
        const [, app, sub, id, isTest] = consoleRoute
        const method = req.method ?? ''
        const want = !app ? 'GET' : sub === 'rotate' ? 'POST' : sub === 'telegram-chats' ? 'GET' : !sub ? '' : id ? (isTest ? 'POST' : 'DELETE') : 'POST'
        if (!want || (sub !== 'alerts' && id) || (sub === 'alerts' && !id && method === 'GET')) return send(res, 404, { error: 'not found' })
        if (method !== want) return send(res, 405, { error: `${method} is not supported on ${path}` })
        const session = sessionAuth(req, res)
        if (!session) return
        const me = session.address
        if (!deps.console || !deps.claimOf) return send(res, 503, { error: 'the console is off on this server: no funded Arkiv writer wallet or reads are configured' })

        if (!app) {
          const key = deps.alerts?.key
          const apps = []
          for (const c of await deps.console.apps(me)) {
            if (!(await owns(c.app, me))) continue
            const subs = key && deps.alerts?.store ? await deps.alerts.store.list(c.app).catch(() => []) : []
            apps.push({ ...c, key_version: deps.keyVersion ? await deps.keyVersion(c.app) : 0, channels: key ? describe(subs, c.app, key) : [] })
          }
          return send(res, 200, { address: me, apps })
        }

        if (!(await owns(app, me))) return send(res, 403, { error: `app ${app} is not owned by ${me}; sign in with the wallet that first published it` })
        if (sub === 'rotate') {
          if (!takeRotation(app)) return send(res, 429, { error: 'too many key rotations for this app; try again within the hour' })
          const { version } = await deps.console.rotate(app, me)
          const now = Date.now()
          const key = issueKey(deps.secret, { address: me, app, iat: now, exp: now + KEY_TTL_MS, v: version })
          return send(res, 200, { app, key, version, expires_at: now + KEY_TTL_MS })
        }
        if (sub === 'telegram-chats') return telegramChats(res, app)
        return alertOps(req, res, { app, id, isTest: Boolean(isTest) })
      }

      const appRoute = /^\/v1\/apps\/([^/]+)\/releases$/.exec(path)
      if (req.method === 'GET' && appRoute && deps.releasesFor) {
        const app = decodeURIComponent(appRoute[1])
        if (!APP_NAME.test(app)) return send(res, 400, { error: 'invalid app name' })
        return send(res, 200, { app, releases: await deps.releasesFor(app) })
      }

      if (req.method === 'POST' && path === '/v1/indexer/run' && deps.indexer) {
        if (!triggerOk(req.headers.authorization)) return send(res, 401, { error: 'missing or wrong indexer trigger secret' })
        const out = runner!.start()
        return out.ok ? send(res, 202, { started: true, startedAt: out.startedAt }) : send(res, out.status, { error: out.error })
      }

      const demoRoute = /^\/v1\/demo\/(hack|fix)$/.exec(path)
      if (req.method === 'POST' && demoRoute && deps.demo) {
        if (!watchOk(req.headers.authorization)) return send(res, 401, { error: 'missing or wrong demo token' })
        if (!deps.demo.deploy) return send(res, 503, { error: 'Hack and Fix are not configured on this server: set VERCEL_TOKEN on the host' })
        const kind = demoRoute[1] as 'hack' | 'fix'
        return send(res, 202, { kind, deployment: await deps.demo.deploy(kind) })
      }

      if (path === '/v1/watch' && deps.watch) {
        if (req.method === 'GET') return send(res, 200, deps.watch.watcher.status())
        if (req.method === 'POST') {
          if (!deps.watch.token) return send(res, 503, { error: 'the demo watch switch is not configured on this server: set DEMO_WATCH_TOKEN (at least 16 characters) on the host' })
          if (!watchOk(req.headers.authorization)) return send(res, 401, { error: 'missing or wrong demo token' })
          const body = (await readJson(req, 4096)) as { domain?: unknown; on?: unknown }
          if (typeof body.on !== 'boolean') return send(res, 400, { error: '"on" must be true or false' })
          if (!body.on) {
            deps.watch.watcher.stop()
            return send(res, 200, deps.watch.watcher.status())
          }
          const domain = typeof body.domain === 'string' ? normalizeDomain(body.domain) : null
          if (!domain) return send(res, 400, { error: '"domain" must be a public hostname such as app.example.com' })
          const out = await deps.watch.watcher.start(domain)
          return out.ok ? send(res, 200, deps.watch.watcher.status()) : send(res, out.status, { error: out.error })
        }
      }

      if (req.method === 'GET' && path === '/v1/indexer/status' && runner) return send(res, 200, runner.status())

      if (req.method === 'GET' && path === '/v1/observations' && deps.observations) {
        return send(res, 200, await deps.observations())
      }

      if (req.method === 'GET' && path === '/v1/activity' && deps.activity) {
        return send(res, 200, await deps.activity())
      }

      const fileRoute = /^\/v1\/files\/(sha256-[0-9a-f]{64})$/.exec(path)
      if (req.method === 'GET' && fileRoute && deps.filesByHash) {
        return send(res, 200, { sha256: fileRoute[1], files: await deps.filesByHash(fileRoute[1]) })
      }

      const domainRoute = /^\/v1\/domains\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && domainRoute && deps.appForDomain) {
        let raw = ''
        try {
          raw = decodeURIComponent(domainRoute[1])
        } catch {
          // a malformed escape is just not a hostname
        }
        const domain = normalizeDomain(raw)
        if (!domain) return send(res, 400, { error: 'not a public hostname; use a name such as app.example.com' })
        return send(res, 200, { domain, app: await deps.appForDomain(domain) })
      }

      return send(res, 404, { error: 'not found' })
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message })
      if (err instanceof WriteNotVerifiedError) {
        return send(res, 502, { error: err.message, phase: err.phase, txHash: err.txHash ?? null })
      }
      return send(res, 500, { error: rootCause(err) })
    } finally {
      // No headers, bodies or keys: method, path, status and time only.
      console.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`)
    }
  })
}
