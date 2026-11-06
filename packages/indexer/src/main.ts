// Indexer CLI. Production runs inside the API (POST /v1/indexer/run, called by GitHub Actions);
// this is for local runs.
//   node src/main.ts            run forever, every INDEXER_INTERVAL_MIN (15) minutes
//   node src/main.ts --once     one run
//   node src/main.ts --dry      one run, print only, no writes
//   node src/main.ts --telegram-chats   list the chats the bot has seen (ids and titles)
//   node src/main.ts --test-alert       send 1 test message to TELEGRAM_CHAT_ID
// Env: ARKIV_INDEXER_PRIVATE_KEY, ARKIV_ACCESS_KEY (optional), HYDRA_API_URL,
//      TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (optional, for alerts).

import { arkivClients, rootCause } from '@hydra/core'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sendTelegram } from './alerts.ts'
import { runOnce } from './run.ts'

const env = process.env

// Telegram setup helpers. The token is never printed.
if (process.argv.includes('--telegram-chats') || process.argv.includes('--test-alert')) {
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set: create a bot with @BotFather and put its token in .env.')
    process.exit(1)
  }
  if (process.argv.includes('--telegram-chats')) {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
    const j = (await res?.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { message?: { chat?: Chat }; my_chat_member?: { chat?: Chat }; channel_post?: { chat?: Chat } }[] } | null
    type Chat = { id: number; type: string; title?: string; username?: string; first_name?: string }
    if (!j?.ok) {
      console.error(`Telegram getUpdates failed: ${j?.description ?? 'no answer'}. Check the token.`)
      process.exit(1)
    }
    const chats = new Map<number, Chat>()
    for (const u of j.result ?? []) for (const c of [u.message?.chat, u.my_chat_member?.chat, u.channel_post?.chat]) if (c) chats.set(c.id, c)
    if (!chats.size) console.log('No chats yet: add the bot to a group or DM it, send any message, then run this again.')
    for (const c of chats.values()) console.log(`${c.id}  ${c.type}  ${c.title ?? c.username ?? c.first_name ?? ''}`)
    process.exit(0)
  }
  if (!env.TELEGRAM_CHAT_ID) {
    console.error('TELEGRAM_CHAT_ID is not set: run --telegram-chats and put the id in .env.')
    process.exit(1)
  }
  const sent = await sendTelegram({ token, chatId: env.TELEGRAM_CHAT_ID, text: 'Hydra test alert: Telegram delivery works. Real alerts arrive when a watched site turns mismatch, loses its domain proof, or loads a new third-party script.' })
  console.log(sent.ok ? 'test alert sent' : sent.error)
  process.exit(sent.ok ? 0 : 1)
}
const DRY = process.argv.includes('--dry')
const ONCE = DRY || process.argv.includes('--once')
const api = (env.HYDRA_API_URL ?? 'https://hydra-api-5xmn.onrender.com').replace(/\/+$/, '')
const INTERVAL_MS = Number(env.INDEXER_INTERVAL_MIN ?? 15) * 60_000

const key = env.ARKIV_INDEXER_PRIVATE_KEY as Hex | undefined
if (!DRY && !key) {
  console.error('ARKIV_INDEXER_PRIVATE_KEY is not set; use --dry to scan without writing.')
  process.exit(1)
}
// Dry runs read earlier observations for this address (read-only): explicit, or derived from the key.
const indexerAddress = (env.HYDRA_INDEXER_ADDRESS as Hex | undefined) ?? (DRY && key ? privateKeyToAccount(key).address : undefined)
const clients = DRY ? null : arkivClients({ accessKey: env.ARKIV_ACCESS_KEY, privateKey: key })
if (clients) console.log(`indexer wallet ${clients.walletClient!.account.address}, every ${INTERVAL_MS / 60_000} min`)

do {
  const t0 = Date.now()
  try {
    const s = await runOnce({ api, clients, indexerAddress })
    for (const line of s.lines) console.log(line)
    for (const tx of s.txs) console.log(`wrote observations: tx ${tx}`)
    for (const e of s.errors) console.error(e)
    console.log(`${s.sites} sites, ${s.alerts} alerts, ${s.written} observations written, ${s.skipped} unchanged, ${s.ms} ms`)
  } catch (err) {
    console.error(`run failed: ${rootCause(err)}`)
  }
  if (ONCE) break
  await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - t0))))
} while (true)
