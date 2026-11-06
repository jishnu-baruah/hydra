// Alert channels per app (T-A30): a team adds a webhook, Slack, Discord or Telegram target, and
// every verdict alert for its app goes there too. Targets are secrets (a Slack or Discord URL is a
// write credential), so they are sealed with ALERT_KEY before they reach Arkiv, listed only by a
// label, and never put in an error or a log line. URLs are only ever called through safePost.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { normalizeDomain, safePost } from '@hydra/core'

export const KINDS = ['webhook', 'slack', 'discord', 'telegram'] as const
export type Kind = (typeof KINDS)[number]
export interface Channel {
  kind: Kind
  target: string // https URL, or a Telegram chat id
  secret?: string // whsec_..., webhook only
}

// One alert, as the indexer sends it (AlertEvent in @hydra/indexer/run) for a bound app.
export interface Verdict {
  app: string
  domain: string
  from: string
  to: string
  problems: string[]
  text: string
  observedAt: number
  test?: true
}

// A hydra.alert_sub row as read back from Arkiv.
export interface StoredSub {
  id: string
  kind: string
  created_at: number
  sealed: Uint8Array
}

export type Sent = { ok: true } | { ok: false; error: string }

const HEX_KEY = /^[0-9a-f]{64}$/i
const keyOf = (keyHex: string) => {
  if (!HEX_KEY.test(keyHex)) throw new Error('ALERT_KEY must be 64 hex characters (32 bytes); generate one with node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  return Buffer.from(keyHex, 'hex')
}

// AES-256-GCM, random 12-byte IV; output iv | tag (16) | ciphertext.
export function seal(json: string, keyHex: string): Uint8Array {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyOf(keyHex), iv)
  const data = Buffer.concat([c.update(json, 'utf8'), c.final()])
  return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), data]))
}

export function open(bytes: Uint8Array, keyHex: string): string {
  const key = keyOf(keyHex)
  const b = Buffer.from(bytes)
  try {
    if (b.length < 28) throw new Error()
    const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12))
    d.setAuthTag(b.subarray(12, 28))
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
  } catch {
    throw new Error('a sealed alert channel did not open: ALERT_KEY changed or the record was altered; delete the channel and add it again')
  }
}

const MAX_URL = 500
const TELEGRAM_CHAT = /^-?\d{1,20}$/

export function checkTarget(kind: unknown, target: unknown): { ok: true; value: { kind: Kind; target: string } } | { ok: false; error: string } {
  if (!KINDS.includes(kind as Kind)) return { ok: false, error: `"kind" must be one of ${KINDS.join(', ')}` }
  const k = kind as Kind
  if (k === 'telegram') {
    const id = typeof target === 'number' && Number.isSafeInteger(target) ? String(target) : typeof target === 'string' ? target.trim() : ''
    if (!TELEGRAM_CHAT.test(id)) return { ok: false, error: 'a Telegram target must be a chat id: an integer such as -1001234567890 (forward a message from the chat to @userinfobot to see it)' }
    return { ok: true, value: { kind: k, target: id } }
  }
  let u: URL | null = null
  try {
    u = new URL(typeof target === 'string' ? target.trim() : '')
  } catch {
    // not a URL
  }
  const host = u && u.protocol === 'https:' && !u.port && !u.username && !u.password ? normalizeDomain(u.hostname) : null
  if (!u || !host) return { ok: false, error: '"target" must be a public https URL on the default port, such as https://hooks.example.com/hydra' }
  u.hash = ''
  if (u.href.length > MAX_URL) return { ok: false, error: `"target" is over ${MAX_URL} characters; use a shorter URL` }
  if (k === 'slack' && !(host === 'hooks.slack.com' && u.pathname.startsWith('/services/'))) {
    return { ok: false, error: 'a Slack target must be an incoming webhook URL, https://hooks.slack.com/services/...' }
  }
  if (k === 'discord' && !((host === 'discord.com' || host === 'discordapp.com') && u.pathname.startsWith('/api/webhooks/'))) {
    return { ok: false, error: 'a Discord target must be a channel webhook URL, https://discord.com/api/webhooks/...' }
  }
  return { ok: true, value: { kind: k, target: u.href } }
}

// What a listing shows. Never the full target.
export function label(kind: string, target: string): string {
  if (kind === 'slack') return 'Slack incoming webhook'
  if (kind === 'discord') return 'Discord webhook'
  if (kind === 'telegram') return `Telegram chat ...${target.slice(-4)}`
  try {
    return `Webhook to ${new URL(target).hostname}`
  } catch {
    return 'Webhook'
  }
}

export const newSecret = (): string => `whsec_${randomBytes(24).toString('base64')}`

// Standard Webhooks: base64 HMAC-SHA256 of "id.timestamp.body", keyed with the secret's base64 part.
export function signWebhook(secret: string, id: string, timestampSec: number, body: string): string {
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  return `v1,${createHmac('sha256', key).update(`${id}.${timestampSec}.${body}`).digest('base64')}`
}

export const explorerUrl = (app: string) => `https://hydra-registry.vercel.app/app/?name=${encodeURIComponent(app)}`

export const testVerdict = (app: string, now = Date.now()): Verdict => ({
  app,
  domain: '',
  from: 'match',
  to: 'match',
  problems: [],
  text: `Hydra test: this channel is set up. Verdict alerts for app ${app} will arrive here.`,
  observedAt: now,
  test: true,
})

export function webhookRequest(v: Verdict, secret: string, o: { id?: string; now?: number } = {}) {
  const body = JSON.stringify({
    type: v.test ? 'hydra.test' : 'hydra.verdict',
    app: v.app,
    domain: v.domain,
    from: v.from,
    to: v.to,
    problems: v.problems.slice(0, 20).map((p) => p.slice(0, 500)),
    observed_at: v.observedAt,
    explorer: explorerUrl(v.app),
  })
  const id = o.id ?? `msg_${randomBytes(12).toString('hex')}`
  const ts = Math.floor((o.now ?? Date.now()) / 1000)
  return {
    body,
    headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': signWebhook(secret, id, ts, body) },
  }
}

// The message text with the explorer link kept whole at the end, cut to fit `max`.
const withLink = (text: string, app: string, max: number) => {
  const link = `\n${explorerUrl(app)}`
  return text.length + link.length <= max ? text + link : `${text.slice(0, max - link.length - 3)}...${link}`
}

// Site data can hold Slack markup (<!channel>, <url|label>), so &, < and > are escaped first.
export const slackBody = (v: Verdict) => ({
  text: withLink(v.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), v.app, 3000),
})

// allowed_mentions with no parse: an @everyone in site data pings nobody.
export const discordBody = (v: Verdict) => ({ content: withLink(v.text, v.app, 2000), allowed_mentions: { parse: [] as string[] } })

export interface DeliverDeps {
  post?: (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number }>
  telegram?: (chatId: string, text: string) => Promise<Sent> // absent: no bot configured
  delayMs?: number
}

// A Telegram chat counts as a team's only after someone in it sent "/hydra <app>" to the bot within the
// window: anyone can type a chat id, but only a member can post in the chat. `updates` is the bot's
// getUpdates result (read without an offset, so nothing is consumed). Newest first, one entry per chat.
export function linkedChats(updates: unknown, app: string, now: number, windowMs = 15 * 60_000): { id: string; title: string }[] {
  if (!Array.isArray(updates)) return []
  const cmd = new RegExp(`^/hydra(@[A-Za-z0-9_]+)?\\s+${app.replace(/[^a-z0-9-]/g, '')}\\s*$`)
  const hits: { id: string; title: string; at: number }[] = []
  for (const u of updates) {
    const m = (u as { message?: { chat?: { id?: unknown; title?: unknown; first_name?: unknown }; text?: unknown; date?: unknown } })?.message
    const id = m?.chat?.id
    const at = Number(m?.date) * 1000
    if (typeof id !== 'number' || typeof m?.text !== 'string' || !cmd.test(m.text.trim()) || !(now - at <= windowMs)) continue
    hits.push({ id: String(id), title: String(m.chat?.title ?? m.chat?.first_name ?? 'chat'), at })
  }
  hits.sort((a, b) => b.at - a.at)
  const seen = new Set<string>()
  return hits.filter((h) => !seen.has(h.id) && seen.add(h.id)).map(({ id, title }) => ({ id, title }))
}

// The bot's answer to "/hydra <app>" or "/chatid": the chat id to paste into the console. The proof
// stays linkedChats, so the reply grants nothing. `seen` holds answered update ids (each message is
// answered once); messages older than `since` (server start) are skipped so a restart does not
// answer the last day again.
export function chatIdReplies(updates: unknown, seen: Set<number>, since: number): { updateId: number; chatId: string; text: string }[] {
  if (!Array.isArray(updates)) return []
  const out: { updateId: number; chatId: string; text: string }[] = []
  for (const u of updates) {
    const updateId = (u as { update_id?: unknown })?.update_id
    const m = (u as { message?: { chat?: { id?: unknown }; text?: unknown; date?: unknown } })?.message
    const id = m?.chat?.id
    if (typeof updateId !== 'number' || typeof id !== 'number' || typeof m?.text !== 'string' || seen.has(updateId)) continue
    const cmd = m.text.trim().match(/^\/(hydra|chatid)(?:@[A-Za-z0-9_]+)?(?:\s+([a-z0-9-]{1,64}))?\s*$/)
    if (!cmd || Number(m.date) * 1000 < since) continue
    seen.add(updateId)
    const app = cmd[2]
    out.push({
      updateId,
      chatId: String(id),
      text: app
        ? `Chat id: ${id}\nPaste it in the Hydra console as the Telegram target for ${app} within 15 minutes.`
        : `Chat id: ${id}\nTo add this chat to an app, send "/hydra <app>" here, then paste the id in the Hydra console within 15 minutes.`,
    })
  }
  return out
}

const NAME: Record<Kind, string> = { webhook: 'the webhook', slack: 'Slack', discord: 'Discord', telegram: 'Telegram' }

// One alert to one channel. HTTP kinds: at most 3 attempts with a short backoff for network errors
// and 5xx; a 3xx or 4xx stops at once. Errors never carry the URL, chat id or secret.
export async function deliver(ch: Channel, v: Verdict, deps: DeliverDeps = {}): Promise<Sent> {
  if (ch.kind === 'telegram') {
    if (!deps.telegram) return { ok: false, error: 'Telegram is not configured on this server (no TELEGRAM_BOT_TOKEN); use another channel kind' }
    const r = await deps.telegram(ch.target, withLink(v.text, v.app, 4000))
    // sendTelegram's advice is for the team chat's env vars; this chat is the team's own.
    // Telegram's own description is not passed on: it would tell a caller which chats the bot is in.
    return r.ok ? r : { ok: false, error: 'Telegram did not take the message: check the Hydra bot is still in the chat' }
  }
  const req = ch.kind === 'webhook'
    ? webhookRequest(v, ch.secret ?? '')
    : { body: JSON.stringify(ch.kind === 'slack' ? slackBody(v) : discordBody(v)), headers: { 'Content-Type': 'application/json' } }
  const post = deps.post ?? ((url, body, headers) => safePost(url, body, headers))
  const name = NAME[ch.kind]
  let error = `${name} was not reached`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status } = await post(ch.target, req.body, req.headers)
      if (status >= 200 && status < 300) return { ok: true }
      if (status >= 300 && status < 400) return { ok: false, error: `${name} answered HTTP ${status}, a redirect, which Hydra does not follow; use the final URL` }
      if (status < 500) return { ok: false, error: `${name} answered HTTP ${status}; check the URL is still active, or delete this channel and add it again` }
      error = `${name} answered HTTP ${status} on 3 attempts; it may be down, try again later`
    } catch (err) {
      const msg = (err instanceof Error ? err.message : 'error').replace(/\bhttps?:\/\/\S+/gi, '<url>')
      error = `${name} could not be reached (${msg}); check the URL and try again later`
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, (deps.delayMs ?? 500) * attempt))
  }
  return { ok: false, error }
}

// The sealed JSON is { app, target, secret? }. Null when it does not open, names another app, or
// holds an unknown kind or a bad target: such a row is skipped, never called.
export function openChannel(sub: StoredSub, app: string, keyHex: string): Channel | null {
  try {
    const j = JSON.parse(open(sub.sealed, keyHex)) as { app?: unknown; target?: unknown; secret?: unknown }
    if (j.app !== app) return null
    const t = checkTarget(sub.kind, j.target)
    if (!t.ok) return null
    return { ...t.value, ...(typeof j.secret === 'string' ? { secret: j.secret } : {}) }
  } catch {
    return null
  }
}

// The indexer's notify hook: every channel of the alert's app, in parallel. Never throws; each
// failure is logged with the app, channel id and kind only.
export function channelNotifier(o: {
  key: string
  list: (app: string) => Promise<StoredSub[]>
  deliver: (ch: Channel, v: Verdict) => Promise<Sent>
  log?: (line: string) => void
}) {
  const log = o.log ?? ((l: string) => console.error(l))
  return async (e: Omit<Verdict, 'app'> & { app?: string }) => {
    const app = e.app
    if (!app) return
    let subs: StoredSub[]
    try {
      subs = await o.list(app)
    } catch (err) {
      return log(`alert channels of ${app} not read: ${err instanceof Error ? err.message : 'error'}; they get no alert this time`)
    }
    await Promise.all(subs.map(async (s) => {
      const ch = openChannel(s, app, o.key)
      if (!ch) return log(`alert channel ${s.id} of ${app} did not open (ALERT_KEY changed?); delete it and add it again`)
      const r = await o.deliver(ch, { ...e, app })
      if (!r.ok) log(`alert to ${s.kind} channel ${s.id} of ${app} failed: ${r.error}`)
    }))
  }
}
